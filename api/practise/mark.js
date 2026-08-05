/*
 * POST /api/practise/mark
 *
 * Marks a finished practise. The knowledge stage is marked against the rubric
 * that came with each question; the exam stage - where there is one - is marked
 * by the same examiner prompt and the same mark scheme the mock papers use, so
 * a 16-mark question is marked as a 16-mark question.
 *
 * Every total is recomputed here from the marks the questions were set with, so
 * a score can never drift away from what was actually available.
 */
import { callGemini, lastModelUsed } from "../test/generate.js";
import { COMPONENTS, optionById, buildMarkingPrompt } from "../../src/exam/aqaHistory.js";
import { buildKnowledgeMarkingPrompt } from "../../src/practise/prompt.js";
import { requireUser } from "../_lib/auth.js";

const MAX_ANSWER_CHARS = 12000;

/* Sent so notesGaps is judged against the student's own notes, not guessed. */
const MAX_NOTE_CHARS = 14000;

const MAX_STRENGTHS = 2;
const MAX_FOCUS_AREAS = 3;

const KNOWLEDGE_RESULT_SCHEMA = {
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
          comment: { type: "STRING" },
          didWell: { type: "ARRAY", items: { type: "STRING" } },
          missedPoints: { type: "ARRAY", items: { type: "STRING" } }
        },
        required: ["number", "mark", "outOf", "comment", "didWell", "missedPoints"]
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
    overallComment: { type: "STRING" }
  },
  required: ["questions", "strengths", "focusAreas", "missedContent", "overallComment"]
};

const EXAM_RESULT_SCHEMA = {
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

function trimAnswers(raw) {
  const out = {};
  Object.keys(raw || {}).forEach((k) => {
    out[k] = String(raw[k] || "").slice(0, MAX_ANSWER_CHARS);
  });
  return out;
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return send(res, 204, {});
  if (req.method !== "POST") return send(res, 405, { error: "Use POST." });

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

  const knowledge = body.knowledge || {};
  const kQuestions = Array.isArray(knowledge.questions) ? knowledge.questions : [];
  if (!kQuestions.length) {
    return send(res, 400, { error: "That practise can't be marked \u2014 it looks incomplete." });
  }
  const kAnswers = trimAnswers(knowledge.answers);

  const notes = String(body.notes || "").slice(0, MAX_NOTE_CHARS);

  const kPrompt = buildKnowledgeMarkingPrompt({
    pageTitle: String(body.pageTitle || ""),
    subjectTitle: String(body.subjectTitle || ""),
    // Rapid recall answers are one sentence by design; the marker must not
    // dock a mark for the brevity the question asked for.
    style: knowledge.style === "recall" ? "recall" : "written",
    notes,
    questions: kQuestions,
    answers: kAnswers,
    timeUsedSeconds: Number(body.timeUsedSeconds) || 0
  });

  // The exam stage is marked only when a real paper was actually set.
  const exam = body.exam || null;
  const component = exam && COMPONENTS[exam.componentId];
  const option = exam && optionById(exam.optionId);
  const markExam = Boolean(
    exam && component && option && Array.isArray(exam.questions) && exam.questions.length
  );
  const eAnswers = markExam ? trimAnswers(exam.answers) : {};

  const examPromise = markExam
    ? (async () => {
        const paper = {
          componentId: component.id,
          optionId: option.id,
          paperTitle: exam.paperTitle || component.paper,
          sectionTitle: exam.sectionTitle || component.section,
          optionLabel: option.label,
          site: exam.site || "",
          totalMarks: exam.questions.reduce((s, q) => s + q.marks + (q.spagMarks || 0), 0),
          timeLimitMinutes: exam.questions.reduce((s, q) => s + (q.guidanceMinutes || 0), 0),
          sources: exam.sources || [],
          questions: exam.questions
        };
        const prompt = buildMarkingPrompt({
          notes,
          componentId: component.id,
          optionId: option.id,
          paper,
          answers: eAnswers,
          timeUsedSeconds: Number(body.timeUsedSeconds) || 0
        });
        return callGemini(prompt.system, prompt.user, EXAM_RESULT_SCHEMA, apiKey);
      })().then(
        (out) => ({ marked: out, error: null }),
        (e) => ({ marked: null, error: e.message || "The exam questions could not be marked." })
      )
    : Promise.resolve({ marked: null, error: null });

  let kMarked;
  let eOut;
  try {
    const both = await Promise.all([
      callGemini(kPrompt.system, kPrompt.user, KNOWLEDGE_RESULT_SCHEMA, apiKey),
      examPromise
    ]);
    kMarked = both[0];
    eOut = both[1];
  } catch (e) {
    return send(res, e.status || 502, {
      error:
        e.status === 429
          ? "Gemini is rate limiting right now. Your answers are saved \u2014 try marking again in a minute."
          : "Couldn't mark the practise: " + e.message
    });
  }

  /* ---------- knowledge stage ---------- */

  const kByNumber = {};
  (kMarked.questions || []).forEach((q) => {
    kByNumber[String(q.number)] = q;
  });

  let kMark = 0;
  let kOutOf = 0;
  const knowledgeQuestions = kQuestions.map((spec) => {
    const m = kByNumber[String(spec.number)] || {};
    const answered = String(kAnswers[String(spec.number)] || "").trim().length > 0;
    const mark = answered ? clamp(m.mark, 0, spec.marks) : 0;
    kMark += mark;
    kOutOf += spec.marks;
    return {
      number: spec.number,
      prompt: spec.prompt,
      topic: spec.topic || "",
      mark,
      outOf: spec.marks,
      comment: answered ? String(m.comment || "") : "You left this one blank.",
      didWell: answered ? (m.didWell || []).map(String) : [],
      missedPoints: (m.missedPoints || []).map(String),
      modelAnswer: String(spec.modelAnswer || ""),
      rubric: (spec.rubric || []).map(String)
    };
  });

  /* ---------- exam stage ---------- */

  let examResult = null;
  if (markExam && eOut.marked) {
    const eByNumber = {};
    (eOut.marked.questions || []).forEach((q) => {
      eByNumber[String(q.number)] = q;
    });

    let eMark = 0;
    let eOutOf = 0;
    const examQuestions = exam.questions.map((spec) => {
      const m = eByNumber[String(spec.number)] || {};
      const answered = String(eAnswers[String(spec.number)] || "").trim().length > 0;
      const mark = answered ? clamp(m.mark, 0, spec.marks) : 0;
      const spagOutOf = spec.spagMarks || 0;
      const spagMark = answered && spagOutOf ? clamp(m.spagMark, 0, spagOutOf) : 0;
      eMark += mark + spagMark;
      eOutOf += spec.marks + spagOutOf;
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

    examResult = {
      componentShort: exam.componentShort || component.short,
      optionLabel: option.label,
      mark: eMark,
      outOf: eOutOf,
      percentage: eOutOf ? Math.round((eMark / eOutOf) * 100) : 0,
      questions: examQuestions,
      strengths: (eOut.marked.strengths || []).map(String),
      focusAreas: (eOut.marked.focusAreas || []).map((f) => ({
        area: String(f.area || ""),
        why: String(f.why || ""),
        action: String(f.action || "")
      })),
      missedContent: (eOut.marked.missedContent || []).map(String),
      notesGaps: (eOut.marked.notesGaps || []).map(String),
      overallComment: String(eOut.marked.overallComment || "")
    };
  }

  const totalMark = kMark + (examResult ? examResult.mark : 0);
  const totalAvailable = kOutOf + (examResult ? examResult.outOf : 0);

  // Focus areas and strengths from both stages, de-duplicated on the area name.
  const focusAreas = [];
  const seenArea = new Set();
  const pushFocus = (list, stage) => {
    (list || []).forEach((f) => {
      const area = String(f.area || "").trim();
      if (!area) return;
      const k = area.toLowerCase();
      if (seenArea.has(k)) return;
      seenArea.add(k);
      focusAreas.push({ area, why: String(f.why || ""), action: String(f.action || ""), stage });
    });
  };
  pushFocus(kMarked.focusAreas, "knowledge");
  if (examResult) pushFocus(examResult.focusAreas, "exam");

  return send(res, 200, {
    result: {
      totalMark,
      totalAvailable,
      percentage: totalAvailable ? Math.round((totalMark / totalAvailable) * 100) : 0,
      knowledge: {
        mark: kMark,
        outOf: kOutOf,
        percentage: kOutOf ? Math.round((kMark / kOutOf) * 100) : 0,
        questions: knowledgeQuestions
      },
      exam: examResult,
      examError: markExam && !examResult ? eOut.error : null,
      strengths: (kMarked.strengths || [])
        .map(String)
        .concat(examResult ? examResult.strengths : [])
        .slice(0, MAX_STRENGTHS),
      focusAreas: focusAreas.slice(0, MAX_FOCUS_AREAS),
      missedContent: (kMarked.missedContent || [])
        .map(String)
        .concat(examResult ? examResult.missedContent : []),
      notesGaps: examResult ? examResult.notesGaps : [],
      overallComment: String(kMarked.overallComment || ""),
      examComment: examResult ? examResult.overallComment : "",
      markedAt: Date.now(),
      model: lastModelUsed()
    }
  });
}
