/*
 * Flashcards from mistakes.
 *
 * This is the primary way flashcards come into existence in ReviseIQ. When a
 * quiz, practise or exam paper is marked, the misses are sent to Gemini along
 * with the passages of the student's own notes that those misses touch, and it
 * writes cards that close the underlying gap.
 *
 * Two things matter here, and both were learned the hard way:
 *
 * 1. The model must write from the NOTES, not from the question. Sending only
 *    the mistake leaves it nothing to write from but the question's wording, so
 *    it paraphrases the question back and produces cards testing things the
 *    student was never expected to know.
 * 2. One gap should become several small cards, not one broad one. Small cards
 *    are what spaced repetition actually works on.
 *
 * Cards are ordinary flashcard (toggle) blocks appended to the page under one
 * heading, so they behave exactly like hand-written ones.
 */
import { getPage } from "../state.js";
import { escapeHtml } from "../utils.js";
import { newBlock } from "../model.js";
import { scheduleSave } from "../storage.js";
import { authHeaders } from "../cloud/auth.js";
import { collectNotes } from "../exam/notes.js";
import { resurfaceCard } from "../srs.js";
import { BANNED_CARD_PATTERNS, MAX_CARDS_PER_RUN, MAX_CARD_NOTE_CHARS } from "./quizPrompt.js";

export const CARDS_HEADING = "Flashcards from your mistakes";

function plain(html) {
  return String(html || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function squash(value) {
  return plain(value)
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* Every card already on the page, keyed by its front, so a repeated mistake
 * resurfaces the card the student owns instead of spawning a near duplicate. */
function existingCards(blocks, into) {
  (blocks || []).forEach((b) => {
    if (b.type === "toggle") {
      const key = squash(b.summary);
      if (key && !into.has(key)) into.set(key, b.id);
    }
    if (Array.isArray(b.children)) existingCards(b.children, into);
  });
  return into;
}

function findCardsHeading(blocks) {
  const want = plain(CARDS_HEADING);
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].type === "heading2" && plain(blocks[i].content) === want) return i;
  }
  return -1;
}

/*
 * The passages of the notes the mistakes actually touch.
 *
 * Sending the whole page would be wasteful and would dilute the material the
 * model needs, so paragraphs are scored on how much vocabulary they share with
 * the misses and the best ones are sent in their original order.
 */
function notesExcerpt(pageId, includeSubpages, misses) {
  let text = "";
  try {
    text = collectNotes(pageId, !!includeSubpages).text || "";
  } catch (e) {
    return "";
  }
  if (!text) return "";
  if (text.length <= MAX_CARD_NOTE_CHARS) return text;

  const stop = new Set([
    "the", "and", "that", "this", "with", "from", "they", "were", "which", "their", "what",
    "when", "have", "been", "than", "then", "there", "about", "would", "could", "because",
    "where", "into", "more", "most", "also", "other", "some", "such", "only", "over", "after"
  ]);
  const wanted = new Set();
  (misses || []).forEach((m) => {
    squash([m.topic, m.question, m.correct, m.explanation, m.detail].filter(Boolean).join(" "))
      .split(" ")
      .forEach((w) => {
        if (w.length > 3 && !stop.has(w)) wanted.add(w);
      });
  });

  const paras = text.split(/\n{2,}/);
  const scored = paras.map((p, i) => {
    const words = squash(p).split(" ");
    let hits = 0;
    words.forEach((w) => {
      if (wanted.has(w)) hits += 1;
    });
    // Headings are cheap and give the model its bearings, so they score well.
    const isHeading = /^#/.test(p.trim());
    return { i: i, p: p, score: hits / Math.max(12, words.length) + (isHeading ? 0.05 : 0) };
  });

  scored.sort((a, b) => b.score - a.score);
  const keep = [];
  let used = 0;
  scored.forEach((s) => {
    if (used + s.p.length > MAX_CARD_NOTE_CHARS) return;
    keep.push(s);
    used += s.p.length + 2;
  });
  keep.sort((a, b) => a.i - b.i);
  return keep.map((s) => s.p).join("\n\n");
}

/*
 * The same deterministic gate the server applies, run again here because the
 * fallback cards never pass through the server at all.
 */
function cardIsUseful(card) {
  const front = squash(card.front);
  const words = front ? front.split(" ").length : 0;
  if (words < 4 || words > 24) return false;
  for (let i = 0; i < BANNED_CARD_PATTERNS.length; i++) {
    if (front.indexOf(squash(BANNED_CARD_PATTERNS[i])) !== -1) return false;
  }
  return String(card.back || "").trim().length > 1;
}

/* Last-resort cards, used only when the model cannot be reached at all. */
function fallbackCards(misses) {
  return (misses || [])
    .filter((m) => m && (m.question || m.detail))
    .slice(0, 12)
    .map((m) => ({
      front: String(m.question || m.detail || "").trim(),
      back: [m.correct, m.explanation, m.detail].filter(Boolean).join(" \u2014 ").trim() || "Check your notes on this.",
      topic: String(m.topic || "").trim(),
      kind: "knowledge"
    }))
    .filter((c) => c.front && c.back);
}

function buildCardBlock(card, attemptId) {
  const block = newBlock("toggle");
  block.summary = escapeHtml(card.front);
  const answer = newBlock("paragraph");
  const label = card.topic
    ? "<br><em>" + escapeHtml(card.topic) + (card.kind === "skill" ? " \u00b7 skill" : "") + "</em>"
    : "";
  answer.content = escapeHtml(card.back) + label;
  block.children = [answer];
  block.collapsed = true;
  // Provenance, so a card can point back at the attempt that produced it.
  if (attemptId) block.fromAttempt = attemptId;
  if (card.topic) block.cardTopic = card.topic;
  return block;
}

async function askGemini(cfg, notes, existing) {
  const res = await fetch("/api/quiz/flashcards", {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({
      source: cfg.source === "test" ? "test" : "quiz",
      pageTitle: cfg.pageTitle || "",
      subjectTitle: cfg.subjectTitle || "",
      misses: cfg.misses || [],
      notes: notes || "",
      existing: existing || []
    })
  });
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    /* fall through */
  }
  if (!res.ok || !data || data.error) {
    throw new Error((data && data.error) || "The server returned an error (" + res.status + ").");
  }
  return Array.isArray(data.cards) ? data.cards : [];
}

/**
 * cfg: { pageId, pageTitle, subjectTitle, source: "quiz"|"test",
 *        includeSubpages, attemptId,
 *        misses: [{ topic, question, correct, chose, explanation, detail }] }
 *
 * Resolves with { made, resurfaced, aiUsed, error, cardIds }. Never throws: a
 * page full of cards is worth more than a clean stack trace, so it falls back
 * to simple cards built from the misses if Gemini is unreachable.
 */
export async function generateFlashcardsFromMisses(cfg) {
  const page = getPage(cfg.pageId);
  const misses = (cfg.misses || []).filter(Boolean);
  const empty = { made: 0, resurfaced: 0, aiUsed: false, error: null, cardIds: [] };
  if (!page || !misses.length) return empty;

  const owned = existingCards(page.blocks, new Map());
  const notes = notesExcerpt(cfg.pageId, cfg.includeSubpages, misses);

  let cards = [];
  let aiUsed = false;
  let error = null;

  try {
    cards = await askGemini(cfg, notes, Array.from(owned.keys()).slice(0, 60));
    aiUsed = cards.length > 0;
  } catch (e) {
    error = e.message;
  }
  if (!cards.length) cards = fallbackCards(misses);
  if (!cards.length) return Object.assign({}, empty, { error: error });

  const seen = new Set();
  const fresh = [];
  const cardIds = [];
  let resurfaced = 0;

  cards.forEach((c) => {
    const key = squash(c.front);
    if (!key || seen.has(key)) return;
    seen.add(key);
    if (owned.has(key)) {
      // They already have this card and got it wrong again: bring it back today
      // rather than cluttering the page with a duplicate.
      resurfaceCard(owned.get(key));
      resurfaced += 1;
      return;
    }
    if (!cardIsUseful(c)) return;
    if (fresh.length >= MAX_CARDS_PER_RUN) return;
    const block = buildCardBlock(c, cfg.attemptId);
    fresh.push(block);
    cardIds.push(block.id);
  });

  if (!fresh.length && !resurfaced) return Object.assign({}, empty, { aiUsed: aiUsed, error: error });

  if (fresh.length) {
    if (findCardsHeading(page.blocks) === -1) {
      const heading = newBlock("heading2");
      heading.content = escapeHtml(CARDS_HEADING);
      page.blocks.push(heading);
    }
    fresh.forEach((b) => page.blocks.push(b));
  }
  scheduleSave();

  return {
    made: fresh.length,
    resurfaced: resurfaced,
    aiUsed: aiUsed,
    error: aiUsed ? null : error,
    cardIds: cardIds
  };
}
