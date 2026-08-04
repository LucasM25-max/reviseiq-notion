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
import { buildFlashcardPrompt } from "../../src/quiz/quizPrompt.js";
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
          kind: { type: "STRING" }
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

  const prompt = buildFlashcardPrompt({
    source: body.source === "test" ? "test" : "quiz",
    pageTitle: str(body.pageTitle, 200),
    subjectTitle: str(body.subjectTitle, 200),
    score: Number(body.score) || 0,
    total: Number(body.total) || misses.length,
    misses
  });

  let out;
  try {
    out = await callGemini(prompt.system, prompt.user, CARD_SCHEMA, apiKey);
  } catch (e) {
    return send(res, e.status || 502, { error: "Gemini could not write the flashcards: " + e.message });
  }

  const cards = (Array.isArray(out && out.cards) ? out.cards : [])
    .map((c) => ({
      front: str(c && c.front, 300).trim(),
      back: str(c && c.back, 600).trim(),
      topic: str(c && c.topic, 80).trim(),
      kind: str(c && c.kind, 20).trim().toLowerCase() === "skill" ? "skill" : "knowledge"
    }))
    .filter((c) => c.front && c.back)
    .slice(0, 12);

  return send(res, 200, { cards });
}
