/*
 * Flashcards from mistakes.
 *
 * This is the primary way flashcards come into existence in ReviseIQ. When a
 * quiz is marked, or an exam paper comes back from the marker, the misses are
 * sent to Gemini and it writes cards that close the underlying gap in
 * knowledge or skill. The student does not have to decide what to revise.
 *
 * Cards are ordinary flashcard (toggle) blocks appended to the page under one
 * heading, so they behave exactly like hand-written ones: they show up in
 * Revise, in the due counts and in the revision schedule from today.
 */
import { getPage } from "../state.js";
import { escapeHtml } from "../utils.js";
import { newBlock } from "../model.js";
import { scheduleSave } from "../storage.js";
import { authHeaders } from "../cloud/auth.js";

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

/* Cards already on the page, so a second run never duplicates them. */
function existingFronts(blocks, into) {
  (blocks || []).forEach((b) => {
    if (b.type === "toggle") into.add(plain(b.summary));
    if (Array.isArray(b.children)) existingFronts(b.children, into);
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

function buildCardBlock(card) {
  const block = newBlock("toggle");
  block.summary = escapeHtml(card.front);
  const answer = newBlock("paragraph");
  const label = card.topic
    ? '<br><em>' + escapeHtml(card.topic) + (card.kind === "skill" ? " \u00b7 skill" : "") + "</em>"
    : "";
  answer.content = escapeHtml(card.back) + label;
  block.children = [answer];
  block.collapsed = true;
  return block;
}

async function askGemini(cfg) {
  const res = await fetch("/api/quiz/flashcards", {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({
      source: cfg.source === "test" ? "test" : "quiz",
      pageTitle: cfg.pageTitle || "",
      subjectTitle: cfg.subjectTitle || "",
      score: cfg.score || 0,
      total: cfg.total || (cfg.misses || []).length,
      misses: cfg.misses || []
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
 * cfg: { pageId, pageTitle, subjectTitle, source: "quiz"|"test", score, total,
 *        misses: [{ topic, question, correct, chose, explanation, detail }] }
 *
 * Resolves with { made, skipped, aiUsed, error }. Never throws: a page full of
 * cards is worth more than a clean stack trace, so it falls back to simple
 * cards built straight from the misses if Gemini is unreachable.
 */
export async function generateFlashcardsFromMisses(cfg) {
  const page = getPage(cfg.pageId);
  const misses = (cfg.misses || []).filter(Boolean);
  if (!page || !misses.length) return { made: 0, skipped: 0, aiUsed: false, error: null };

  let cards = [];
  let aiUsed = false;
  let error = null;

  try {
    cards = await askGemini(Object.assign({}, cfg, { misses }));
    aiUsed = cards.length > 0;
  } catch (e) {
    error = e.message;
  }
  if (!cards.length) cards = fallbackCards(misses);
  if (!cards.length) return { made: 0, skipped: 0, aiUsed: false, error };

  const seen = existingFronts(page.blocks, new Set());
  const fresh = [];
  let skipped = 0;
  cards.forEach((c) => {
    const key = plain(c.front);
    if (!key || seen.has(key)) {
      skipped += 1;
      return;
    }
    seen.add(key);
    fresh.push(buildCardBlock(c));
  });

  if (!fresh.length) return { made: 0, skipped, aiUsed, error };

  if (findCardsHeading(page.blocks) === -1) {
    const heading = newBlock("heading2");
    heading.content = escapeHtml(CARDS_HEADING);
    page.blocks.push(heading);
  }
  fresh.forEach((b) => page.blocks.push(b));
  scheduleSave();

  return { made: fresh.length, skipped, aiUsed, error: aiUsed ? null : error };
}
