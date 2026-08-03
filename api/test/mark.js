/*
 * POST /api/test/mark
 *
 * Marks a finished script against the mark scheme that came with the paper,
 * then reports strengths, focus areas and the exact points that were missed.
 */
import { COMPONENTS, optionById, buildMarkingPrompt } from "../../src/exam/aqaHistory.js";
import { callGemini } from "./generate.js";
import { requireUser } from "../_lib/auth.js";

const MAX_ANSWER_CHARS = 12000;

const RESULT_SCHEMA = {
  type: "OBJECT",
  properties: {
    questions: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          number: { type: "INTEGER" },
          mark: { type: "INTEGER" },
          outOf: { type: "INTEGER" },
          level: { type: "STRING" },
          examinerComment: { type: "STRING" },
          didWell: { type: "ARRAY", items: { type: "STRING" } },
          missedPoints: { type: "ARRAY", items: { type: "STRING" } },
          spagMark: { type: "INTEGER" },
          spagOutOf: { type: "INTEGER" },
          spagComment: { type: "STRING" }
        },
        required: ["number", "mark", "outOf", "level", "examinerComment", "didWell", "missedPoints"]
      }
    },
    strengths: { type: "ARRAY", items: { type: "STRING" } },
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
    },
    missedContent: { type: "ARRAY", items: { type: "STRING" } },
    notesGaps: { type: "ARRAY", items: { type: "STRING" } },
    overallComment: { type: "STRING" }
  },
  required: ["questions", "strengths", "focusAreas", "missedContent", "overallComment"]
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

function clamp(n, min, max) {
  const v = Math.round(Number(n) || 0);
  return Math.max(min, Math.min(max, v));
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return send(res, 204, {});
  if (req.method !== "POST") return send(res, 405, { error: "Use POST." });

  // Optional Firebase gate. Off until FIREBASE_PROJECT_ID is set, and
  // only mandatory when REQUIRE_AUTH=1, so nothing breaks mid-setup.
  const user = await requireUser(req, res, send);
  if (!user) return;

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

  const paper = body.paper;
  const component = paper && COMPONENTS[paper.componentId];
  const option = paper && optionById(paper.optionId);
  if (!paper || !component || !option || !Array.isArray(paper.questions)) {
    return send(res, 400, { error: "That paper can't be marked \u2014 it looks incomplete." });
  }

  const answers = {};
  Object.keys(body.answers || {}).forEach((k) => {
    answers[k] = String(body.answers[k] || "").slice(0, MAX_ANSWER_CHARS);
  });

  const prompt = buildMarkingPrompt({
    componentId: component.id,
    optionId: option.id,
    paper,
    answers,
    timeUsedSeconds: Number(body.timeUsedSeconds) || 0
  });

  let marked;
  try {
    marked = await callGemini(prompt.system, prompt.user, RESULT_SCHEMA, apiKey);
  } catch (e) {
    return send(res, e.status || 502, {
      error:
        e.status === 429
          ? "Gemini is rate limiting right now. Your answers are saved \u2014 try marking again in a minute."
          : "Couldn't mark the paper: " + e.message
    });
  }

  // Recompute every total from the specification so the score can never drift.
  const byNumber = {};
  (marked.questions || []).forEach((q) => {
    byNumber[String(q.number)] = q;
  });

  let totalMark = 0;
  let totalAvailable = 0;

  const questions = paper.questions.map((spec) => {
    const m = byNumber[String(spec.number)] || {};
    const answered = String(answers[String(spec.number)] || "").trim().length > 0;
    const mark = answered ? clamp(m.mark, 0, spec.marks) : 0;
    const spagOutOf = spec.spagMarks || 0;
    const spagMark = answered && spagOutOf ? clamp(m.spagMark, 0, spagOutOf) : 0;
    totalMark += mark + spagMark;
    totalAvailable += spec.marks + spagOutOf;
    return {
      number: spec.number,
      stem: spec.stem,
      mark,
      outOf: spec.marks,
      level: answered ? String(m.level || "") : "Not attempted",
      examinerComment: answered ? String(m.examinerComment || "") : "You left this question blank.",
      didWell: answered ? (m.didWell || []).map(String) : [],
      missedPoints: (m.missedPoints || []).map(String),
      spagMark,
      spagOutOf,
      spagComment: spagOutOf ? String(m.spagComment || "") : ""
    };
  });

  return send(res, 200, {
    result: {
      totalMark,
      totalAvailable,
      percentage: totalAvailable ? Math.round((totalMark / totalAvailable) * 100) : 0,
      questions,
      strengths: (marked.strengths || []).map(String),
      focusAreas: (marked.focusAreas || []).map((f) => ({
        area: String(f.area || ""),
        why: String(f.why || ""),
        action: String(f.action || "")
      })),
      missedContent: (marked.missedContent || []).map(String),
      notesGaps: (marked.notesGaps || []).map(String),
      overallComment: String(marked.overallComment || ""),
      markedAt: Date.now()
    }
  });
}
