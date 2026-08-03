/*
 * Permanent record of everything the examiner told you.
 *
 * Mock exam feedback is worthless if it disappears with the results screen, so
 * every focus area and every missed point is stored in the workspace state and
 * surfaced on the Today dashboard and on the page it came from until the
 * student ticks it off.
 */
import { store } from "../state.js";
import { uid } from "../utils.js";
import { scheduleSave } from "../storage.js";

export function ensureInsights() {
  if (!Array.isArray(store.state.insights)) store.state.insights = [];
  return store.state.insights;
}

export function ensureTests() {
  if (!store.state.tests || typeof store.state.tests !== "object") store.state.tests = {};
  return store.state.tests;
}

function key(kind, text) {
  return kind + "::" + String(text || "").toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim().slice(0, 90);
}

function add(item) {
  const list = ensureInsights();
  const k = key(item.kind, item.text);
  if (!k) return;
  const existing = list.find((i) => i.key === k && i.pageId === item.pageId);
  if (existing) {
    existing.seen = (existing.seen || 1) + 1;
    existing.lastSeen = item.lastSeen;
    existing.testId = item.testId;
    if (item.detail) existing.detail = item.detail;
    // Something you have already ticked off but got wrong again comes back.
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
    componentShort: item.componentShort || "",
    questionNumber: item.questionNumber || null,
    testId: item.testId,
    createdAt: item.lastSeen,
    lastSeen: item.lastSeen,
    seen: 1,
    resolvedAt: null
  });
}

/** Pull focus areas and missed points out of a marked attempt. */
export function recordFromAttempt(attempt) {
  if (!attempt || !attempt.result) return;
  const now = Date.now();
  const base = {
    pageId: attempt.pageId,
    pageTitle: attempt.pageTitle,
    subjectTitle: attempt.subjectTitle,
    componentShort: attempt.componentShort,
    testId: attempt.id,
    lastSeen: now
  };
  const r = attempt.result;

  (r.focusAreas || []).forEach((f) => {
    add(Object.assign({}, base, { kind: "focus", text: f.area || f.title || "", detail: f.action || f.why || "" }));
  });
  (r.missedContent || []).forEach((m) => {
    add(Object.assign({}, base, { kind: "missed", text: typeof m === "string" ? m : m.point || "", detail: typeof m === "string" ? "" : m.why || "" }));
  });
  (r.notesGaps || []).forEach((g) => {
    add(Object.assign({}, base, { kind: "gap", text: typeof g === "string" ? g : g.point || "", detail: "Your notes do not appear to cover this." }));
  });
  (r.questions || []).forEach((q) => {
    (q.missedPoints || []).forEach((p) => {
      add(
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

export function openInsights(filter) {
  const list = ensureInsights().filter((i) => !i.resolvedAt);
  const rows = filter && filter.pageId ? list.filter((i) => i.pageId === filter.pageId) : list;
  const kinds = { focus: 0, gap: 1, missed: 2 };
  return rows
    .slice()
    .sort((a, b) => {
      if ((b.seen || 1) !== (a.seen || 1)) return (b.seen || 1) - (a.seen || 1);
      const ka = kinds[a.kind] === undefined ? 3 : kinds[a.kind];
      const kb = kinds[b.kind] === undefined ? 3 : kinds[b.kind];
      if (ka !== kb) return ka - kb;
      return (b.lastSeen || 0) - (a.lastSeen || 0);
    });
}

export function countOpenInsights() {
  return ensureInsights().filter((i) => !i.resolvedAt).length;
}

export function resolveInsight(id) {
  const item = ensureInsights().find((i) => i.id === id);
  if (!item) return;
  item.resolvedAt = Date.now();
  scheduleSave();
}

export function unresolveInsight(id) {
  const item = ensureInsights().find((i) => i.id === id);
  if (!item) return;
  item.resolvedAt = null;
  scheduleSave();
}

export function clearResolved() {
  store.state.insights = ensureInsights().filter((i) => !i.resolvedAt);
  scheduleSave();
}

/* ---------- attempts ---------- */

export function saveAttempt(attempt) {
  const tests = ensureTests();
  tests[attempt.id] = attempt;
  scheduleSave();
}

export function getAttempt(id) {
  return ensureTests()[id] || null;
}

export function attemptsForPage(pageId) {
  const tests = ensureTests();
  return Object.keys(tests)
    .map((k) => tests[k])
    .filter((t) => t.pageId === pageId)
    .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
}

export function allAttempts() {
  const tests = ensureTests();
  return Object.keys(tests)
    .map((k) => tests[k])
    .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
}

export function unfinishedAttemptForPage(pageId) {
  return attemptsForPage(pageId).find((t) => t.status === "in-progress") || null;
}

export function deleteAttempt(id) {
  const tests = ensureTests();
  delete tests[id];
  scheduleSave();
}
