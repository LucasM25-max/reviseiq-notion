/*
 * Storage for Quiz me: past quiz attempts, and the weak spots they reveal.
 *
 * Quiz misses are filed into the same insights list the mock exams use, so a
 * gap found by a quiz shows up in "Exam feedback" on the page and on Today,
 * and is ticked off the same way.
 */
import { store } from "../state.js";
import { uid } from "../utils.js";
import { scheduleSave } from "../storage.js";
import { ensureInsights } from "../exam/insights.js";

export function ensureQuizzes() {
  if (!store.state.quizzes || typeof store.state.quizzes !== "object") store.state.quizzes = {};
  return store.state.quizzes;
}

export function saveQuizAttempt(attempt) {
  const all = ensureQuizzes();
  all[attempt.id] = attempt;
  scheduleSave();
}

export function getQuizAttempt(id) {
  return ensureQuizzes()[id] || null;
}

export function quizzesForPage(pageId) {
  const all = ensureQuizzes();
  return Object.keys(all)
    .map((k) => all[k])
    .filter((q) => q.pageId === pageId)
    .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
}

export function allQuizAttempts() {
  const all = ensureQuizzes();
  return Object.keys(all)
    .map((k) => all[k])
    .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
}

export function unfinishedQuizForPage(pageId) {
  return quizzesForPage(pageId).find((q) => q.status === "in-progress") || null;
}

export function deleteQuizAttempt(id) {
  const all = ensureQuizzes();
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
    // Something already ticked off but got wrong again comes back.
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
    componentShort: item.componentShort || "Quiz",
    questionNumber: null,
    testId: item.testId,
    createdAt: item.lastSeen,
    lastSeen: item.lastSeen,
    seen: 1,
    resolvedAt: null
  });
}

/**
 * Every wrong answer becomes a "gap" insight, keyed on the question's topic so
 * getting three questions on the same topic wrong records one weak spot, not
 * three. Any focus areas from the optional review pass are recorded too.
 */
export function recordQuizInsights(attempt) {
  if (!attempt || !attempt.result) return;
  const now = Date.now();
  const base = {
    pageId: attempt.pageId,
    pageTitle: attempt.pageTitle,
    subjectTitle: attempt.subjectTitle || "",
    testId: attempt.id,
    lastSeen: now
  };

  (attempt.result.wrong || []).forEach((w) => {
    addInsight(
      Object.assign({}, base, {
        kind: "gap",
        text: w.topic || w.question || "",
        detail: w.correct ? "Correct answer: " + w.correct : ""
      })
    );
  });

  (attempt.result.focusAreas || []).forEach((f) => {
    addInsight(
      Object.assign({}, base, {
        kind: "focus",
        text: f.area || "",
        detail: [f.why, f.action].filter(Boolean).join(" ")
      })
    );
  });

  scheduleSave();
}
