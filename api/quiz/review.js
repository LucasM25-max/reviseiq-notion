/*
 * POST /api/quiz/review
 *
 * The optional "where I'm weak" pass after a quiz. Only the missed questions
 * are sent - never the notes - so this call stays small, fast and cheap. It is
 * skipped entirely when the student got everything right.
 */
import { callGemini } from "../test/generate.js";
import { buildReviewPrompt } from "../../src/quiz/quizPrompt.js";
import { requireUser } from "../_lib/auth.js";

const REVIEW_SCHEMA = {
  type: "OBJECT",
  properties: {
    focusAreas: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          area: { type: "STRING" },
          why: { type: "STRING" },
          action: { type: "STRING" }
        },
        required: ["area", "why", "action"]
      }
    }
  },
  required: ["focusAreas"]
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

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return send(res, 204, {});
  if (req.method !== "POST") return send(res, 405, { error: "Use POST." });

  // Optional Firebase gate. Off until FIREBASE_PROJECT_ID is set, and
  // only mandatory when REQUIRE_AUTH=1, so nothing breaks mid-setup.
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

  const missed = (Array.isArray(body.missed) ? body.missed : []).slice(0, 20).map((m) => ({
    topic: String((m && m.topic) || "").slice(0, 80),
    question: String((m && m.question) || "").slice(0, 300),
    correct: String((m && m.correct) || "").slice(0, 200),
    chose: String((m && m.chose) || "").slice(0, 200)
  }));

  if (!missed.length) return send(res, 200, { focusAreas: [] });

  const prompt = buildReviewPrompt({
    pageTitle: String(body.pageTitle || "").slice(0, 200),
    score: Number(body.score) || 0,
    total: Number(body.total) || missed.length,
    missed
  });

  let out;
  try {
    out = await callGemini(prompt.system, prompt.user, REVIEW_SCHEMA, apiKey);
  } catch (e) {
    return send(res, e.status || 502, { error: "Couldn't summarise your weak spots: " + e.message });
  }

  const focusAreas = (out.focusAreas || []).slice(0, 4).map((f) => ({
    area: String(f.area || "").trim().slice(0, 80),
    why: String(f.why || "").trim().slice(0, 300),
    action: String(f.action || "").trim().slice(0, 300)
  }));

  return send(res, 200, { focusAreas });
}
