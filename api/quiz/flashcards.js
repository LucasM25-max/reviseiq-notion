/*
 * POST /api/quiz/flashcards
 *
 * Turns the mistakes from a quiz or a marked exam paper into revision
 * flashcards. This is the primary way cards are created in ReviseIQ: the
 * student never has to decide what to make a card about, the gaps in their
 * own answers decide it for them.
 *
 * Only the mistakes are sent - never the notes - so the call stays small.
 */
import { callGemini } from "../test/generate.js";
import {
  buildFlashcardPrompt,
  BANNED_CARD_PATTERNS,
  MAX_CARDS_PER_RUN,
  MAX_CARD_NOTE_CHARS
} from "../../src/quiz/quizPrompt.js";
import { requireUser } from "../_lib/auth.js";

const CARD_SCHEMA = {
  type: "OBJECT",
  properties: {
    cards: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          front: { type: "STRING" },
          back: { type: "STRING" },
          topic: { type: "STRING" },
          kind: { type: "STRING" },
          evidence: { type: "STRING" }
        },
        required: ["front", "back", "topic", "kind"]
      }
    }
  },
  required: ["cards"]
};

function send(res, status, payload) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.status(status).send(JSON.stringify(payload));
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body);
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function str(value, max) {
  return String(value == null ? "" : value).slice(0, max);
}


/* Normalised for comparison: case, punctuation and spacing removed. */
function squash(value) {
  return String(value == null ? "" : value)
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/*
 * Asking the model for good cards is not enough on its own: the failure mode is
 * a card shaped like the question that exposed the gap rather than like a fact
 * worth knowing. These checks are cheap and deterministic, so they run on every
 * card and drop the ones the prompt failed to prevent.
 */
function cardIsUseful(card, notesSquashed) {
  const front = squash(card.front);
  const words = front ? front.split(" ").length : 0;
  if (words < 4 || words > 24) return false;

  // Shaped like the quiz question rather than like a fact.
  for (let i = 0; i < BANNED_CARD_PATTERNS.length; i++) {
    if (front.indexOf(squash(BANNED_CARD_PATTERNS[i])) !== -1) return false;
  }

  // An answer with no proper noun, number or capitalised term is almost always
  // a vague restatement rather than something recallable.
  const back = String(card.back || "");
  const hasAnchor = /\d/.test(back) || /(^|[^.!?]\s)[A-Z][a-z]{2,}/.test(back) || back.indexOf(";") !== -1;
  if (!hasAnchor && card.kind !== "skill") return false;

  // If notes were supplied, the quoted evidence must really appear in them.
  // A card whose evidence was invented is a card testing something the student
  // was never expected to know.
  if (notesSquashed && card.kind !== "skill") {
    const ev = squash(card.evidence);
    if (ev.split(" ").length >= 3 && notesSquashed.indexOf(ev) === -1) {
      const bits = ev.split(" ").filter((w) => w.length > 3);
      const hits = bits.filter((w) => notesSquashed.indexOf(w) !== -1).length;
      if (!bits.length || hits / bits.length < 0.6) return false;
    }
  }
  return true;
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return send(res, 204, {});
  if (req.method !== "POST") return send(res, 405, { error: "Use POST." });

  const user = await requireUser(req, res, send);
  if (!user) return;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return send(res, 500, { error: "No Gemini API key is configured." });

  let body;
  try {
    body = await readBody(req);
  } catch (e) {
    return send(res, 400, { error: "Could not read the request." });
  }

  const misses = (Array.isArray(body.misses) ? body.misses : []).slice(0, 24).map((m) => ({
    topic: str(m && m.topic, 80),
    question: str(m && m.question, 400),
    correct: str(m && m.correct, 300),
    chose: str(m && m.chose, 300),
    explanation: str(m && m.explanation, 300),
    detail: str(m && m.detail, 300)
  }));

  if (!misses.length) return send(res, 200, { cards: [] });

  const notes = str(body.notes, MAX_CARD_NOTE_CHARS);
  const existing = (Array.isArray(body.existing) ? body.existing : [])
    .slice(0, 60)
    .map((f) => str(f, 200))
    .filter(Boolean);

  const prompt = buildFlashcardPrompt({
    source: body.source === "test" ? "test" : "quiz",
    pageTitle: str(body.pageTitle, 200),
    subjectTitle: str(body.subjectTitle, 200),
    misses,
    notes,
    existing
  });

  let out;
  try {
    out = await callGemini(prompt.system, prompt.user, CARD_SCHEMA, apiKey);
  } catch (e) {
    return send(res, e.status || 502, { error: "Gemini could not write the flashcards: " + e.message });
  }

  const notesSquashed = notes ? squash(notes) : "";
  const existingSquashed = new Set(existing.map(squash));

  const all = (Array.isArray(out && out.cards) ? out.cards : []).map((c) => ({
    front: str(c && c.front, 300).trim(),
    back: str(c && c.back, 600).trim(),
    topic: str(c && c.topic, 80).trim(),
    kind: str(c && c.kind, 20).trim().toLowerCase() === "skill" ? "skill" : "knowledge",
    evidence: str(c && c.evidence, 200).trim()
  }));

  const seen = new Set();
  const cards = [];
  let rejected = 0;
  let skills = 0;

  all.forEach((c) => {
    if (!c.front || !c.back) return;
    const key = squash(c.front);
    if (!key || seen.has(key) || existingSquashed.has(key)) return;
    if (!cardIsUseful(c, notesSquashed)) {
      rejected += 1;
      return;
    }
    if (c.kind === "skill") {
      if (skills >= 2) return;
      skills += 1;
    }
    seen.add(key);
    if (cards.length < MAX_CARDS_PER_RUN) cards.push(c);
  });

  return send(res, 200, { cards, rejected });
}
