/*
 * The evidence ledger.
 *
 * Quizzes, practises and mock papers are stored in three separate maps, and for
 * a while three different modules each interpreted those maps their own way:
 * the spaced-repetition code decided whether a page had "been tested", the plan
 * engine worked out a readiness score, and the results strip built its own row
 * shape. Three readings of the same data can disagree with each other, and any
 * new kind of marked work has to be wired into all of them.
 *
 * So all of it lives here. Everything downstream reads attempts through this
 * module and nothing else scans the raw maps.
 *
 * This module deliberately imports nothing but state and utils, so any feature
 * can use it without risking an import cycle.
 */
import { store } from "./state.js";

/*
 * How much each kind of marked work counts as evidence that a topic is known.
 * A quiz is recognition under no time pressure; a mock is the real thing; a
 * practise is written and marked but short, so it sits between them.
 */
export const EVIDENCE_WEIGHT = {
  quiz: 1,
  practise: 0.6,
  test: 1
};

export const KIND_META = {
  quiz: { label: "Quiz", icon: "quiz" },
  practise: { label: "Practise", icon: "marksheet" },
  test: { label: "Mock paper", icon: "exam" }
};

function mapFor(kind) {
  if (kind === "quiz") return store.state.quizzes || {};
  if (kind === "practise") return store.state.practises || {};
  return store.state.tests || {};
}

function answeredCount(obj) {
  return Object.keys(obj || {}).filter((k) => String(obj[k] == null ? "" : obj[k]).trim()).length;
}

/* A single fraction between 0 and 1, whatever shape the result happens to be. */
export function fractionOf(attempt) {
  if (!attempt || !attempt.result) return null;
  const r = attempt.result;
  if (typeof r.percentage === "number") return Math.max(0, Math.min(100, r.percentage)) / 100;
  if (typeof r.score === "number" && r.total) return Math.max(0, Math.min(1, r.score / r.total));
  if (typeof r.correct === "number" && r.total) return Math.max(0, Math.min(1, r.correct / r.total));
  if (typeof r.totalMark === "number" && r.totalAvailable) {
    return Math.max(0, Math.min(1, r.totalMark / r.totalAvailable));
  }
  return null;
}

function normalise(kind, a) {
  const open = a.status !== "marked";
  const frac = fractionOf(a);
  const row = {
    kind: kind,
    id: a.id,
    pageId: a.pageId,
    pageTitle: a.pageTitle || "",
    at: a.finishedAt || a.startedAt || 0,
    startedAt: a.startedAt || 0,
    open: open,
    status: a.status,
    weight: EVIDENCE_WEIGHT[kind] || 1,
    percentage: open || frac === null ? null : Math.round(frac * 100),
    fraction: open ? null : frac,
    cardsMade: a.cardsMade || 0,
    cardsResurfaced: a.cardsResurfaced || 0,
    title: "",
    score: null,
    detail: "",
    attrs: ""
  };

  if (kind === "quiz") {
    const total = a.quiz && a.quiz.questions ? a.quiz.questions.length : 0;
    row.title = a.title || "Quiz";
    row.score = open ? null : a.result.score + " / " + a.result.total;
    row.detail = open ? answeredCount(a.answers) + " of " + total + " answered" : "";
    row.attrs = ' data-quiz-act="' + (open ? "resume" : "results") + '" data-quiz-id="' + a.id + '"';
  } else if (kind === "practise") {
    const answers = a.answers || {};
    const answered = answeredCount(answers.knowledge) + answeredCount(answers.exam);
    const total = a.practise
      ? ((a.practise.knowledge && a.practise.knowledge.questions) || []).length +
        (a.practise.exam ? (a.practise.exam.questions || []).length : 0)
      : 0;
    row.title = a.title || "Practise";
    row.score = open ? null : a.result.totalMark + " / " + a.result.totalAvailable;
    row.detail = open
      ? answered + " of " + total + " answered"
      : a.practise && a.practise.exam
        ? "written + exam questions"
        : "written questions";
    row.attrs = ' data-practise-open="' + (open ? "resume" : "results") + '" data-practise-id="' + a.id + '"';
  } else {
    row.title = a.optionLabel || "Mock paper";
    row.score = open ? null : a.result.totalMark + " / " + a.result.totalAvailable;
    row.detail = a.componentShort || "";
    row.attrs = ' data-test-act="' + (open ? "resume" : "results") + '" data-test-id="' + a.id + '"';
  }
  return row;
}

/**
 * Every attempt worth showing, normalised into one row shape.
 * pageId omitted (or null) means everywhere.
 * Unfinished first, since that is the only actionable row, then newest.
 */
export function attemptRows(pageId) {
  const rows = [];
  ["quiz", "practise", "test"].forEach((kind) => {
    const map = mapFor(kind);
    for (const k in map) {
      const a = map[k];
      if (!a || !a.id) continue;
      if (pageId && a.pageId !== pageId) continue;
      if (a.status !== "marked" && a.status !== "in-progress") continue;
      if (a.status === "marked" && !a.result) continue;
      rows.push(normalise(kind, a));
    }
  });
  rows.sort((x, y) => (y.open ? 1 : 0) - (x.open ? 1 : 0) || (y.at || 0) - (x.at || 0));
  return rows;
}

/** Marked attempts only, newest first. */
export function markedRows(pageId) {
  return attemptRows(pageId).filter((r) => !r.open && r.fraction !== null);
}

/**
 * What we know about how well a page is known.
 * { pct, lastAt, attempts, weight } where pct is a 0-1 fraction from the most
 * recent marked attempt, and weight is the strongest evidence available.
 */
export function evidenceForPage(pageId) {
  const rows = attemptRows(pageId).filter((r) => r.status === "marked");
  let pct = null;
  let lastAt = 0;
  let weight = 0;
  rows.forEach((r) => {
    if (r.weight > weight) weight = r.weight;
    if (r.fraction === null) return;
    if (r.at >= lastAt) {
      lastAt = r.at;
      pct = r.fraction;
    }
  });
  return { pct: pct, lastAt: lastAt, attempts: rows.length, weight: weight };
}

/** Has this page ever been assessed in any way? */
export function hasEvidence(pageId) {
  const rows = attemptRows(pageId);
  for (let i = 0; i < rows.length; i++) if (rows[i].status === "marked") return true;
  return false;
}

/** The most recent attempt of any kind, finished or not. */
export function latestAttempt(pageId) {
  return attemptRows(pageId)[0] || null;
}

/** Anything left unfinished, which the whole app treats as the first call on the student's time. */
export function unfinishedRows(pageId) {
  return attemptRows(pageId).filter((r) => r.open);
}
