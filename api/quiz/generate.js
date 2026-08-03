/*
 * POST /api/quiz/generate
 *
 * Writes a hard multiple-choice quiz from a student's notes. The Gemini key
 * lives in the GEMINI_API_KEY environment variable on Vercel and never reaches
 * the browser.
 */
import { callGemini, lastModelUsed } from "../test/generate.js";
import { buildQuizPrompt, clampCount, MIN_QUIZ_WORDS, MAX_NOTE_CHARS } from "../../src/quiz/quizPrompt.js";

const QUIZ_SCHEMA = {
  type: "OBJECT",
  properties: {
    title: { type: "STRING" },
    questions: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          number: { type: "INTEGER" },
          question: { type: "STRING" },
          options: { type: "ARRAY", items: { type: "STRING" } },
          correctIndex: { type: "INTEGER" },
          explanation: { type: "STRING" },
          distractorNotes: { type: "ARRAY", items: { type: "STRING" } },
          topic: { type: "STRING" }
        },
        required: ["number", "question", "options", "correctIndex", "explanation", "topic"]
      }
    }
  },
  required: ["questions"]
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

function normaliseQuestion(raw, number) {
  const options = (Array.isArray(raw.options) ? raw.options : [])
    .map((o) => String(o || "").trim())
    .filter(Boolean)
    .slice(0, 4);
  if (options.length !== 4) return null;

  const question = String(raw.question || "").trim();
  if (!question) return null;

  let correctIndex = Number(raw.correctIndex);
  if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex > 3) correctIndex = 0;

  const notes = Array.isArray(raw.distractorNotes) ? raw.distractorNotes.map((n) => String(n || "").trim()) : [];
  while (notes.length < 4) notes.push("");

  return {
    number,
    question,
    options,
    correctIndex,
    explanation: String(raw.explanation || "").trim(),
    distractorNotes: notes.slice(0, 4),
    topic: String(raw.topic || "").trim().slice(0, 60)
  };
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return send(res, 204, {});
  if (req.method !== "POST") return send(res, 405, { error: "Use POST." });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return send(res, 500, {
      error: "No Gemini API key is configured. Add GEMINI_API_KEY in your Vercel project settings and redeploy."
    });
  }

  let body;
  try {
    body = await readBody(req);
  } catch (e) {
    return send(res, 400, { error: "Could not read the request." });
  }

  const notes = String(body.notes || "").slice(0, MAX_NOTE_CHARS);
  const words = notes.trim() ? notes.trim().split(/\s+/).length : 0;
  if (words < MIN_QUIZ_WORDS) {
    return send(res, 400, { error: "There aren't enough notes here to build a quiz from." });
  }

  const count = clampCount(body.count, words);
  const prompt = buildQuizPrompt({
    count,
    pageTitle: String(body.pageTitle || "").slice(0, 200),
    includedPages: Array.isArray(body.includedPages) ? body.includedPages.slice(0, 40) : [],
    notes
  });

  let generated;
  try {
    generated = await callGemini(prompt.system, prompt.user, QUIZ_SCHEMA, apiKey);
  } catch (e) {
    return send(res, e.status || 502, {
      error:
        e.status === 429
          ? "Gemini is rate limiting right now. Wait a minute and try again."
          : "Couldn't build the quiz: " + e.message
    });
  }

  const seen = new Set();
  const questions = [];
  (generated.questions || []).forEach((raw) => {
    const q = normaliseQuestion(raw || {}, questions.length + 1);
    if (!q) return;
    const fingerprint = q.question.toLowerCase().replace(/[^a-z0-9 ]/g, "").slice(0, 80);
    if (seen.has(fingerprint)) return;
    seen.add(fingerprint);
    questions.push(q);
  });

  if (questions.length < 5) {
    return send(res, 502, { error: "Gemini returned too few usable questions. Try again." });
  }

  return send(res, 200, {
    quiz: {
      title: String(generated.title || "").trim().slice(0, 90) || String(body.pageTitle || "Quiz"),
      questions: questions.slice(0, count),
      generatedAt: Date.now(),
      model: lastModelUsed()
    }
  });
}
