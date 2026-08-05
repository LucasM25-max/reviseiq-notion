/*
 * Storage for Practise attempts, and the weak spots they reveal.
 *
 * A practise is real evidence of retrieval - written answers marked against a
 * mark scheme - so its misses are filed into the same insights list the quizzes
 * and the mock papers use. A gap found by a practise therefore shows up under
 * "Exam feedback" on the page and in the Plan, and is ticked off the same way.
 */
import { store } from "../state.js";
import { uid } from "../utils.js";
import { scheduleSave } from "../storage.js";
import { ensureInsights } from "../exam/insights.js";

/*
 * How much a practise counts as evidence, next to a full mock paper.
 * A practise is written, marked work, but it is short and untimed against a
 * real paper, so it is worth rather less than sitting the section properly.
 */
export const PRACTISE_EVIDENCE_WEIGHT = 0.6;

export function ensurePractises() {
  if (!store.state.practises || typeof store.state.practises !== "object") store.state.practises = {};
  return store.state.practises;
}

export function savePractiseAttempt(attempt) {
  const all = ensurePractises();
  all[attempt.id] = attempt;
  scheduleSave();
}

export function getPractiseAttempt(id) {
  return ensurePractises()[id] || null;
}

export function practisesForPage(pageId) {
  const all = ensurePractises();
  return Object.keys(all)
    .map((k) => all[k])
    .filter((p) => p.pageId === pageId)
    .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
}

export function allPractiseAttempts() {
  const all = ensurePractises();
  return Object.keys(all)
    .map((k) => all[k])
    .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
}

export function unfinishedPractiseForPage(pageId) {
  return practisesForPage(pageId).find((p) => p.status === "in-progress") || null;
}

export function deletePractiseAttempt(id) {
  const all = ensurePractises();
  delete all[id];
  scheduleSave();
}

/* ---------- feeding the permanent feedback list ---------- */

function insightKey(kind, text) {
  return (
    kind +
    "::" +
    String(text || "")
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 90)
  );
}

function addInsight(item) {
  const list = ensureInsights();
  const k = insightKey(item.kind, item.text);
  if (!k) return;
  const existing = list.find((i) => i.key === k && i.pageId === item.pageId);
  if (existing) {
    existing.seen = (existing.seen || 1) + 1;
    existing.lastSeen = item.lastSeen;
    if (item.detail) existing.detail = item.detail;
    // Something already ticked off but missed again comes back.
    existing.resolvedAt = null;
    return;
  }
  list.push({
    id: uid(),
    key: k,
    kind: item.kind,
    text: item.text,
    detail: item.detail || "",
    pageId: item.pageId,
    pageTitle: item.pageTitle,
    subjectTitle: item.subjectTitle || "",
    componentShort: item.componentShort || "Practise",
    questionNumber: item.questionNumber || null,
    testId: item.testId,
    createdAt: item.lastSeen,
    lastSeen: item.lastSeen,
    seen: 1,
    resolvedAt: null
  });
}

/**
 * Pulls the focus areas, the missed points and any gaps in the notes out of a
 * marked practise.
 */
export function recordPractiseInsights(attempt) {
  if (!attempt || !attempt.result) return;
  const now = Date.now();
  const r = attempt.result;
  const base = {
    pageId: attempt.pageId,
    pageTitle: attempt.pageTitle,
    subjectTitle: attempt.subjectTitle || "",
    componentShort: "Practise",
    testId: attempt.id,
    lastSeen: now
  };

  (r.focusAreas || []).forEach((f) => {
    addInsight(
      Object.assign({}, base, {
        kind: "focus",
        text: f.area || "",
        detail: [f.why, f.action].filter(Boolean).join(" ")
      })
    );
  });

  (r.missedContent || []).forEach((m) => {
    addInsight(Object.assign({}, base, { kind: "missed", text: typeof m === "string" ? m : m.point || "" }));
  });


  // Points missed on individual questions, which are the most concrete of all.
  ((r.knowledge && r.knowledge.questions) || []).forEach((q) => {
    (q.missedPoints || []).forEach((p) => {
      addInsight(
        Object.assign({}, base, {
          kind: "missed",
          text: typeof p === "string" ? p : p.point || "",
          questionNumber: q.number
        })
      );
    });
  });

  ((r.exam && r.exam.questions) || []).forEach((q) => {
    (q.missedPoints || []).forEach((p) => {
      addInsight(
        Object.assign({}, base, {
          kind: "missed",
          text: typeof p === "string" ? p : p.point || "",
          questionNumber: q.number
        })
      );
    });
  });

  scheduleSave();
}

/**
 * Everything a practise revealed, in the shape the flashcard writer expects:
 * the question, what a full-mark answer contains, and what was missing.
 */
export function missesFromPractise(attempt) {
  const r = attempt && attempt.result;
  if (!r) return [];
  const out = [];

  ((r.knowledge && r.knowledge.questions) || []).forEach((q) => {
    if (q.mark >= q.outOf) return;
    out.push({
      topic: q.topic || q.prompt || "",
      question: q.prompt || "",
      correct: q.modelAnswer || (q.rubric || []).join("; "),
      chose: "",
      explanation: q.comment || "",
      detail: (q.missedPoints || []).join("; ")
    });
  });

  ((r.exam && r.exam.questions) || []).forEach((q) => {
    if (q.mark >= q.outOf) return;
    out.push({
      topic: "Exam question " + q.number,
      question: q.stem || "",
      correct: "",
      chose: "",
      explanation: q.examinerComment || "",
      detail: (q.missedPoints || []).join("; ")
    });
  });

  return out;
}
