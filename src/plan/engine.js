/*
 * Revision planner engine.
 *
 * Pure-ish: it reads the workspace and returns a schedule. It never touches
 * the DOM and never saves, so it can be reasoned about (and tested) on its
 * own. src/plan/store.js owns persistence; src/render/plan.js owns the view.
 *
 * The design follows what the evidence actually supports for exam revision:
 *   - retrieval practice beats re-reading, so almost every task is a quiz, a
 *     flashcard session or a paper rather than "read your notes";
 *   - distributed practice with expanding gaps beats massing, so each topic
 *     gets several passes spread across the run-up to its exam (Cepeda et al.
 *     found the best gap is roughly 10-20% of the retention interval, which is
 *     what passOffsets() approximates);
 *   - interleaving subjects beats blocking them, so a day mixes 2-3 subjects.
 */
import { store, getPage } from "../state.js";
import { daysUntil, pad2 } from "../utils.js";
import {
  cardsForPage,
  isDue,
  estimateMinutes,
  subjectOf,
  subjectExamDays,
  maturityOf,
  lapseRateOf,
  pageHasBeenTested,
  pageWrittenOn,
  dueBySubject,
  todayKey
} from "../srs.js";
import { pageWordCount } from "../exam/notes.js";
import { COMPONENTS, HISTORY_TITLE_MATCH, MIN_NOTE_WORDS } from "../exam/aqaHistory.js";

/* How far ahead we are willing to plan, and how far ahead we plan when no
   exam dates have been entered at all. */
export const MAX_HORIZON_DAYS = 120;
export const STEADY_HORIZON_DAYS = 21;
const MIN_WORDS_FOR_TOPIC = 40;
const TEST_EVERY_DAYS = 5;
const TEST_WINDOW_DAYS = 28;
/* Papers get the time the real paper gets. A section is whatever the exam
   registry says (60 minutes for every AQA History section); a full paper is
   both sections of that paper back to back. Never a made-up round number. */
export const SECTION_MINUTES = (function () {
  let longest = 60;
  for (const id in COMPONENTS) {
    const m = COMPONENTS[id].timeLimitMinutes;
    if (typeof m === "number" && m > longest) longest = m;
  }
  return longest;
})();
export const FULL_PAPER_MINUTES = SECTION_MINUTES * 2;
/* A mock is allowed to blow through the day's time budget - you cannot sit
   half a paper. When one is scheduled, nothing else is added to that day. */
const FULL_PAPER_WINDOW_DAYS = 14;

/* ---------- date helpers (local time, same day keys as the SRS) ---------- */

export function keyOf(date) {
  return date.getFullYear() + "-" + pad2(date.getMonth() + 1) + "-" + pad2(date.getDate());
}

export function addDays(key, n) {
  const d = new Date(key + "T00:00:00");
  d.setDate(d.getDate() + n);
  return keyOf(d);
}

export function weekdayOf(key) {
  return new Date(key + "T00:00:00").getDay();
}

export function daysBetween(fromKey, toKey) {
  const a = new Date(fromKey + "T00:00:00");
  const b = new Date(toKey + "T00:00:00");
  return Math.round((b - a) / 86400000);
}

/* ---------- topics ---------- */

function countOwnCards(blocks, out) {
  if (!Array.isArray(blocks)) return;
  blocks.forEach((b) => {
    if (!b) return;
    if (b.type === "toggle") {
      if (String(b.summary || "").replace(/<[^>]+>/g, "").trim()) out.push(b.id);
      countOwnCards(b.children, out);
    } else if (b.type === "callout") {
      countOwnCards(b.children, out);
    }
  });
}

function attemptPercent(attempt) {
  if (!attempt || !attempt.result) return null;
  const r = attempt.result;
  if (typeof r.percentage === "number") return Math.max(0, Math.min(100, r.percentage)) / 100;
  if (typeof r.score === "number" && r.total) return Math.max(0, Math.min(1, r.score / r.total));
  if (typeof r.correct === "number" && r.total) return Math.max(0, Math.min(1, r.correct / r.total));
  return null;
}

/* Most recent quiz/paper score on a page, and when it happened. */
function evidenceForPage(pageId) {
  let pct = null;
  let when = 0;
  let count = 0;
  const scan = (map) => {
    for (const k in map) {
      const a = map[k];
      if (!a || a.pageId !== pageId || !a.result) continue;
      count += 1;
      const at = a.finishedAt || a.startedAt || 0;
      const p = attemptPercent(a);
      if (p === null) continue;
      if (at >= when) {
        when = at;
        pct = p;
      }
    }
  };
  scan(store.state.quizzes || {});
  scan(store.state.tests || {});
  return { pct: pct, lastAt: when, attempts: count };
}

function unresolvedInsightCount(pageId) {
  const list = Array.isArray(store.state.insights) ? store.state.insights : [];
  return list.filter((i) => i && i.pageId === pageId && !i.resolvedAt).length;
}

/* AQA History pages can sit a full paper. Kept in step with testEligibility()
   without importing the session module (which would make a cycle). */
function testEligible(pageId, subject, words) {
  if (!subject || subject.type !== "subject") return false;
  if (!HISTORY_TITLE_MATCH.test(subject.title || "")) return false;
  if (subject.examBoard !== "AQA") return false;
  return words >= MIN_NOTE_WORDS;
}

/**
 * Every page worth revising, with everything the planner needs to rank it.
 */
export function topicUnits() {
  const units = [];
  for (const id in store.state.pages) {
    const page = store.state.pages[id];
    if (!page) continue;
    const ownIds = [];
    countOwnCards(page.blocks, ownIds);
    const words = pageWordCount(id);
    if (ownIds.length === 0 && words < MIN_WORDS_FOR_TOPIC) continue;

    const subject = subjectOf(id);
    const cards = cardsForPage(id).filter((c) => ownIds.indexOf(c.id) > -1);
    const ev = evidenceForPage(id);
    const lapse = lapseRateOf(cards);
    const examDays = subjectExamDays(subject);

    units.push({
      pageId: id,
      title: page.title || "Untitled",
      icon: page.icon,
      subjectId: subject ? subject.id : id,
      subjectTitle: subject ? subject.title || "Untitled" : "",
      examDays: examDays,
      words: words,
      cards: cards.length,
      dueCount: cards.filter((c) => isDue(c.id)).length,
      maturity: maturityOf(cards),
      lapse: lapse,
      tested: ev.attempts > 0,
      attempts: ev.attempts,
      lastScore: ev.pct,
      lastAt: ev.lastAt,
      insights: unresolvedInsightCount(id),
      testEligible: testEligible(id, subject, words),
      written: pageWrittenOn(page)
    });
  }
  return units;
}

/* ---------- readiness and priority ---------- */

function daysSince(ms) {
  if (!ms) return null;
  return Math.max(0, Math.round((Date.now() - ms) / 86400000));
}

/**
 * How ready this topic looks, 0..1. Evidence of retrieval counts for most of
 * it: a topic you have quizzed and scored well on is in better shape than one
 * with a pile of hand-written flashcards and no test behind it.
 */
export function readiness(u) {
  const evidence = u.tested ? 1 : u.cards > 0 ? 0.5 : 0;
  let accuracy = 0.5;
  if (u.lastScore !== null && u.lastScore !== undefined) accuracy = u.lastScore;
  if (u.lapse !== null && u.lapse !== undefined) {
    accuracy = u.lastScore === null || u.lastScore === undefined ? 1 - u.lapse : (accuracy + (1 - u.lapse)) / 2;
  }
  const since = daysSince(u.lastAt);
  const decay = since === null ? 1 : Math.min(1, since / 21);
  const score = 0.35 * evidence + 0.3 * accuracy + 0.25 * u.maturity + 0.1 * (1 - decay);
  return Math.max(0, Math.min(1, score));
}

export function examWeight(examDays) {
  if (examDays === null || examDays === undefined) return 0.25;
  return 1 / (1 + examDays / 14);
}

export function priorityOf(u) {
  const gapSize = 1 - readiness(u);
  const boost = Math.min(3, u.insights) / 3 * 0.15 + (u.dueCount > 0 ? 0.08 : 0);
  return gapSize * examWeight(u.examDays) + boost * examWeight(u.examDays);
}

/* ---------- passes: how many, and when ---------- */

/**
 * Number of spaced passes to give a topic before its exam. Short windows get
 * fewer, longer windows get more, because the useful gap between passes grows
 * with the interval you are trying to remember over.
 */
export function passCountForWindow(days) {
  if (days <= 2) return 1;
  if (days <= 9) return 2;
  if (days <= 30) return 3;
  if (days <= 60) return 4;
  return 5;
}

/* Fractions of the window, chosen so each gap is roughly 1.5-1.8x the last
   and the final pass always lands in the last stretch before the exam. */
const PASS_FRACTIONS = {
  1: [0.55],
  2: [0.12, 0.78],
  3: [0.08, 0.4, 0.85],
  4: [0.05, 0.26, 0.55, 0.88],
  5: [0.04, 0.18, 0.4, 0.65, 0.9]
};

export function passOffsets(windowDays, count) {
  const fracs = PASS_FRACTIONS[count] || PASS_FRACTIONS[3];
  const out = [];
  fracs.forEach((f) => {
    let day = Math.round(windowDays * f);
    if (day < 0) day = 0;
    if (day > windowDays) day = windowDays;
    // Never two passes on the same day: push later ones out.
    while (out.indexOf(day) > -1) day += 1;
    if (day <= Math.max(windowDays, 0)) out.push(day);
  });
  return out;
}

/* ---------- task shapes ---------- */

/* Calibration learnt from how long tasks really take, injected by the store at
   the start of every build. Papers are never calibrated: a paper takes as long
   as the real paper takes. */
let pace = {};

function applyPace(kind, minutes) {
  const f = pace[kind];
  if (!f || kind === "test") return minutes;
  return Math.max(5, Math.round((minutes * f) / 5) * 5);
}

function kindForPass(u, index, count, daysBeforeExam) {
  const last = index === count - 1;
  if (last && u.examDays !== null && daysBeforeExam <= 7) return "final";
  // A topic that has never been examined and has a long run-up gets one
  // reading pass to learn it; everything after that is retrieval.
  if (index === 0 && !u.tested && u.cards === 0 && (u.examDays === null || u.examDays > 21)) return "read";
  if (u.cards > 0 && index % 2 === 1) return "cards";
  return "quiz";
}

function minutesForTask(kind, u) {
  return applyPace(kind, baseMinutesForTask(kind, u));
}

function baseMinutesForTask(kind, u) {
  if (kind === "due") return estimateMinutes(u.dueCount);
  if (kind === "cards") return estimateMinutes(Math.max(4, u.cards));
  if (kind === "quiz") return 15;
  if (kind === "test") return u.fullPaper ? FULL_PAPER_MINUTES : SECTION_MINUTES;
  if (kind === "read") return Math.max(10, Math.min(30, Math.round(u.words / 180 / 5) * 5 || 10));
  if (kind === "final") return u.cards > 0 ? Math.min(25, estimateMinutes(Math.max(4, u.cards))) : 15;
  return 15;
}

function whyForTask(kind, u) {
  const weak =
    u.lastScore !== null && u.lastScore !== undefined
      ? "last score " + Math.round(u.lastScore * 100) + "%"
      : u.lapse !== null && u.lapse !== undefined
        ? Math.round(u.lapse * 100) + "% of reviews forgotten"
        : "";
  if (kind === "due") return u.dueCount + " card" + (u.dueCount === 1 ? "" : "s") + " due today";
  if (kind === "quiz") {
    if (!u.tested) return "never been tested on this";
    return weak ? "check it has stuck \u00B7 " + weak : "check it has stuck";
  }
  if (kind === "cards") {
    const base = u.cards + " flashcard" + (u.cards === 1 ? "" : "s") + " from your mistakes";
    return weak ? base + " \u00B7 " + weak : base;
  }
  if (kind === "read") return "learn it first \u2014 nothing tested here yet";
  if (kind === "test") {
    return u.fullPaper
      ? "both sections back to back \u00b7 " + FULL_PAPER_MINUTES + " minutes, timed"
      : "one section under timed conditions \u00b7 " + SECTION_MINUTES + " minutes";
  }
  if (kind === "final") return "last look before the exam";
  return "";
}

function makeTask(kind, u, index) {
  return {
    id: kind + ":" + u.pageId + ":" + (index === undefined ? 0 : index),
    kind: kind,
    pageId: u.pageId,
    subjectId: u.subjectId,
    title: u.title,
    subjectTitle: u.subjectTitle,
    icon: u.icon,
    minutes: minutesForTask(kind, u),
    why: whyForTask(kind, u),
    passIndex: index === undefined ? 0 : index,
    fullPaper: kind === "test" ? !!u.fullPaper : false
  };
}

/* Cards that are due right now, grouped by subject. Only ever used for today:
   we cannot know what will be due next Tuesday, so we do not pretend to. */
export function dueTasksForToday() {
  return dueBySubject().map((g) => {
    const page = getPage(g.subjectId);
    return {
      id: "due:" + g.subjectId + ":0",
      kind: "due",
      pageId: g.subjectId,
      subjectId: g.subjectId,
      title: g.title,
      subjectTitle: page && page.id !== g.subjectId ? g.title : "",
      icon: g.icon,
      minutes: estimateMinutes(g.cards.length),
      why: g.cards.length + " card" + (g.cards.length === 1 ? "" : "s") + " due" +
        (g.examDays !== null ? " \u00B7 exam in " + g.examDays + " day" + (g.examDays === 1 ? "" : "s") : ""),
      passIndex: 0,
      count: g.cards.length
    };
  });
}

/* ---------- the schedule ---------- */

function examDayMap(startKey) {
  const map = {};
  const pages = store.state.pages;
  for (const id in pages) {
    const p = pages[id];
    if (p.type !== "subject" || !Array.isArray(p.examDates)) continue;
    p.examDates.forEach((ex) => {
      const d = daysUntil(ex.date);
      if (d === null || d < 0) return;
      const key = addDays(startKey, d);
      (map[key] = map[key] || []).push(p.id);
    });
  }
  return map;
}

export function capacityFor(settings, key) {
  const mins = Array.isArray(settings.minutesByWeekday) ? settings.minutesByWeekday : [];
  const v = Number(mins[weekdayOf(key)]);
  return isFinite(v) && v > 0 ? v : 0;
}

/**
 * Builds the whole schedule from today to the last exam.
 * Returns { days, horizon, dropped } where days is { "YYYY-MM-DD": [task] }.
 */
export function buildSchedule(settings, startKey) {
  const start = startKey || todayKey();
  pace = settings && settings.pace && typeof settings.pace === "object" ? settings.pace : {};
  const narrow = !!(settings && settings.narrowScope);
  const units = topicUnits();
  const examDays = examDayMap(start);

  let horizon = STEADY_HORIZON_DAYS;
  units.forEach((u) => {
    if (u.examDays !== null && u.examDays > horizon) horizon = u.examDays;
  });
  horizon = Math.min(MAX_HORIZON_DAYS, Math.max(7, horizon));

  const days = {};
  const used = {};
  for (let i = 0; i <= horizon; i++) {
    const k = addDays(start, i);
    days[k] = [];
    used[k] = 0;
  }

  const candidates = [];
  units.forEach((u) => {
    if (!u.written && u.cards === 0) return;
    const windowDays = u.examDays === null ? STEADY_HORIZON_DAYS : Math.min(u.examDays, horizon);
    if (windowDays < 0) return;
    // Narrowed scope: one pass fewer per topic, so the same time covers the
    // material that matters most rather than spreading thinner.
    const count = narrow ? Math.max(1, passCountForWindow(windowDays) - 1) : passCountForWindow(windowDays);
    const offsets = passOffsets(windowDays, count);
    const prio = priorityOf(u);
    offsets.forEach((off, i) => {
      let kind = kindForPass(u, i, count, windowDays - off);
      // Reading is the first thing to go when time is short.
      if (narrow && kind === "read") kind = "quiz";
      candidates.push({ preferred: off, priority: prio + (i === 0 ? 0.04 : 0), task: makeTask(kind, u, i) });
    });
  });

  /* Mock papers, only where a real paper exists for the subject, only in the
     run-up, and no more than about two a week. Close to the exam they become
     full papers (both sections, in one sitting) as long as the subject has at
     least two topics worth examining; further out they are single sections. */
  const testCandidates = [];
  if (settings.autoScheduleTests !== false) {
    const bySubject = {};
    units.forEach((u) => {
      if (!u.testEligible || u.examDays === null || u.examDays < 3) return;
      (bySubject[u.subjectId] = bySubject[u.subjectId] || []).push(u);
    });
    for (const sid in bySubject) {
      const list = bySubject[sid].sort((a, b) => priorityOf(b) - priorityOf(a));
      const exam = list[0].examDays;
      const canSitFull = list.length >= 2;
      const subjectPage = getPage(sid);
      const first = Math.max(1, exam - TEST_WINDOW_DAYS);
      let pick = 0;
      for (let off = first; off <= exam - 2; off += TEST_EVERY_DAYS) {
        pick += 1;
        const daysLeft = exam - off;
        const full = canSitFull && daysLeft <= FULL_PAPER_WINDOW_DAYS;
        if (full) {
          const unit = {
            pageId: sid,
            title: subjectPage ? subjectPage.title || "Untitled" : list[0].subjectTitle,
            subjectTitle: "",
            subjectId: sid,
            icon: subjectPage ? subjectPage.icon : list[0].icon,
            cards: 0,
            dueCount: 0,
            words: 0,
            examDays: exam,
            fullPaper: true,
            lastScore: null,
            lapse: null
          };
          testCandidates.push({ preferred: off, priority: priorityOf(list[0]) + 0.03, task: makeTask("test", unit, 90 + pick) });
        } else {
          const u = list[(pick - 1) % list.length];
          testCandidates.push({ preferred: off, priority: priorityOf(u) + 0.02, task: makeTask("test", u, 90 + pick) });
        }
      }
    }
  }

  candidates.sort((a, b) => b.priority - a.priority);
  testCandidates.sort((a, b) => a.preferred - b.preferred);

  const dropped = [];
  const blocked = {};
  const ctx = { days: days, used: used, settings: settings, start: start, horizon: horizon, examDays: examDays, blocked: blocked };
  testCandidates.forEach((c) => {
    if (!placeTask(c, ctx)) dropped.push(c.task);
  });
  candidates.forEach((c) => {
    if (!placeTask(c, ctx)) dropped.push(c.task);
  });

  // Inside a day, lead with the most urgent work and avoid two tasks from the
  // same subject sitting next to each other.
  for (const k in days) days[k] = interleave(days[k]);

  return { days: days, horizon: horizon, dropped: dropped, generatedFor: start };
}

function placeTask(c, ctx) {
  const isTest = c.task.kind === "test";
  const order = isTest ? [0, 1, -1, 2, -2, 3, -3] : [0, 1, -1, 2, -2, 3, -3, 4, 5];
  for (let i = 0; i < order.length; i++) {
    const off = c.preferred + order[i];
    if (off < 0 || off > ctx.horizon) continue;
    const key = addDays(ctx.start, off);
    const cap = capacityFor(ctx.settings, key);
    if (cap === 0) continue; // rest day
    // A mock paper takes over its day, so nothing else joins it.
    if (ctx.blocked[key]) continue;
    const sitting = ctx.examDays[key];
    if (sitting) {
      // On an exam day, only a final look at the subject being sat.
      if (c.task.kind !== "final" || sitting.indexOf(c.task.subjectId) === -1) continue;
    }
    const list = ctx.days[key];
    if (list.some((t) => t.pageId === c.task.pageId)) continue;
    if (isTest) {
      // Papers are placed before anything else, so an empty day is expected;
      // if something is already there, look elsewhere rather than overload it.
      if (list.length > 0) continue;
      list.push(c.task);
      ctx.used[key] += c.task.minutes;
      ctx.blocked[key] = true;
      return true;
    }
    const subjects = {};
    list.forEach((t) => (subjects[t.subjectId] = true));
    const maxSubjects = ctx.settings.maxSubjectsPerDay || 3;
    if (!subjects[c.task.subjectId] && Object.keys(subjects).length >= maxSubjects) continue;
    if (list.length > 0 && ctx.used[key] + c.task.minutes > cap) continue;
    list.push(c.task);
    ctx.used[key] += c.task.minutes;
    return true;
  }
  return false;
}

function interleave(list) {
  const rest = list.slice();
  const out = [];
  while (rest.length) {
    let idx = 0;
    for (let i = 0; i < rest.length; i++) {
      const prev = out.length ? out[out.length - 1].subjectId : null;
      if (rest[i].subjectId !== prev) {
        idx = i;
        break;
      }
    }
    out.push(rest.splice(idx, 1)[0]);
  }
  return out;
}

/**
 * Is the plan actually achievable? Compares what is scheduled (plus anything
 * that would not fit) against the capacity left before each exam.
 */
export function planHealth(schedule, settings) {
  let scheduled = 0;
  let capacity = 0;
  const start = schedule.generatedFor;
  for (let i = 0; i <= schedule.horizon; i++) {
    const k = addDays(start, i);
    capacity += capacityFor(settings, k);
    (schedule.days[k] || []).forEach((t) => (scheduled += t.minutes));
  }
  let droppedMinutes = 0;
  (schedule.dropped || []).forEach((t) => (droppedMinutes += t.minutes));
  return {
    scheduled: scheduled,
    capacity: capacity,
    droppedMinutes: droppedMinutes,
    droppedCount: (schedule.dropped || []).length,
    behind: droppedMinutes > 0
  };
}
