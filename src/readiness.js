/*
 * Where you actually stand.
 *
 * Everything else in ReviseIQ answers "what should I do in the next hour".
 * This module answers the other question: if you sat the paper tomorrow, what
 * would you get, is that going up, and where are the marks going.
 *
 * It invents no new data. It is pure aggregation over the evidence ledger, the
 * spaced-repetition records and the plan engine's own definition of a topic, so
 * a number shown here can never disagree with the number shown on the page it
 * came from.
 */
import { store } from "./state.js";
import { markedRows } from "./evidence.js";
import { topicUnits, readiness } from "./plan/engine.js";
import { shakyPages } from "./srs.js";

/*
 * Grade boundaries as a percentage of the paper.
 *
 * Real boundaries move every year and differ by subject, so these are the
 * middle of the range AQA has published across recent series. That is why every
 * number this module produces is reported as an estimate with a confidence
 * attached, and never as a grade full stop.
 */
export const GRADE_BANDS = [
  { grade: "9", min: 78 },
  { grade: "8", min: 70 },
  { grade: "7", min: 62 },
  { grade: "6", min: 54 },
  { grade: "5", min: 46 },
  { grade: "4", min: 38 },
  { grade: "3", min: 30 },
  { grade: "2", min: 22 },
  { grade: "1", min: 14 }
];

/* How much each kind of marked work says about a real exam mark. A multiple
   choice quiz is recognition, so it counts for far less than written work. */
const GRADE_WEIGHT = { test: 1, practise: 0.6, quiz: 0.25 };

/* Evidence older than this is halved, and halved again, and so on. */
const HALF_LIFE_DAYS = 30;

/* The line between "recently" and "before that" when working out a trend. */
const TREND_WINDOW_DAYS = 21;

/* Below this many percentage points a change is noise, not a trend. */
const TREND_THRESHOLD = 3;

export function gradeForPercent(pct) {
  if (pct === null || pct === undefined) return null;
  for (let i = 0; i < GRADE_BANDS.length; i++) {
    if (pct >= GRADE_BANDS[i].min) return GRADE_BANDS[i].grade;
  }
  return "U";
}

function daysSince(ms) {
  if (!ms) return null;
  return Math.max(0, (Date.now() - ms) / 86400000);
}

function recencyWeight(at) {
  const days = daysSince(at);
  if (days === null) return 0.5;
  return Math.pow(0.5, days / HALF_LIFE_DAYS);
}

/* A weighted mean of marked attempts, in percentage points. */
function weightedMean(rows) {
  let sum = 0;
  let weight = 0;
  rows.forEach((r) => {
    if (r.percentage === null) return;
    const w = (GRADE_WEIGHT[r.kind] || 0.5) * recencyWeight(r.at);
    sum += r.percentage * w;
    weight += w;
  });
  if (!weight) return null;
  return sum / weight;
}

/* How far the mark scheme was from being met, by size of question. Only mock
   papers carry question-level marks, so only mock papers are read here. */
function lossByQuestionSize(pageIds) {
  const buckets = {};
  const spag = { mark: 0, outOf: 0, n: 0 };
  const tests = store.state.tests || {};
  for (const k in tests) {
    const a = tests[k];
    if (!a || a.status !== "marked" || !a.result) continue;
    if (pageIds.indexOf(a.pageId) === -1) continue;
    (a.result.questions || []).forEach((q) => {
      const outOf = Number(q.outOf) || 0;
      if (!outOf) return;
      const label = outOf <= 4 ? "4-mark questions" : outOf <= 8 ? "8-mark questions" : outOf <= 12 ? "12-mark questions" : "16-mark essays";
      const b = buckets[label] || (buckets[label] = { label: label, mark: 0, outOf: 0, n: 0 });
      b.mark += Number(q.mark) || 0;
      b.outOf += outOf;
      b.n += 1;
      if (Number(q.spagOutOf) > 0) {
        spag.mark += Number(q.spagMark) || 0;
        spag.outOf += Number(q.spagOutOf);
        spag.n += 1;
      }
    });
  }

  const rows = Object.keys(buckets)
    .map((k) => buckets[k])
    .filter((b) => b.n >= 2 && b.outOf > 0)
    .map((b) => ({ label: b.label, pct: Math.round((b.mark / b.outOf) * 100), n: b.n }))
    .sort((a, b) => a.pct - b.pct);

  const worst = rows[0] || null;
  const best = rows.length > 1 ? rows[rows.length - 1] : null;
  const spagPct = spag.outOf ? Math.round((spag.mark / spag.outOf) * 100) : null;

  if (!worst) return null;
  // Only worth saying when one kind of question is genuinely worse than another.
  if (best && best.pct - worst.pct < 10 && worst.pct >= 60) {
    return spagPct !== null && spagPct < 60 ? { text: "Losing SPaG marks: " + spagPct + "% of those available.", pct: spagPct } : null;
  }
  return {
    text: "Weakest on " + worst.label + ": " + worst.pct + "% across " + worst.n + (best ? ", against " + best.pct + "% on " + best.label : "") + ".",
    pct: worst.pct
  };
}

/**
 * One row per subject, in the order the exams arrive.
 *
 * {
 *   id, title, icon, examDays, topics, examined, coverage,
 *   readinessPct, scorePct, grade, confidence, confidenceNote,
 *   trend: { dir, delta } | null, loss: { text } | null,
 *   weak: [{ pageId, title, action, reason }]
 * }
 */
export function subjectStanding() {
  const units = topicUnits();
  if (!units.length) return [];

  const shaky = {};
  shakyPages(40).forEach((r) => (shaky[r.pageId] = true));

  const groups = {};
  units.forEach((u) => {
    const g =
      groups[u.subjectId] ||
      (groups[u.subjectId] = {
        id: u.subjectId,
        title: u.subjectTitle || u.title,
        icon: (store.state.pages[u.subjectId] || {}).icon,
        examDays: u.examDays,
        pageIds: [u.subjectId],
        topics: 0,
        examined: 0,
        readinessSum: 0,
        weak: []
      });
    const r = readiness(u);
    g.topics += 1;
    g.readinessSum += r;
    if (u.tested) g.examined += 1;
    if (g.pageIds.indexOf(u.pageId) === -1) g.pageIds.push(u.pageId);

    const reason = !u.tested ? "never tested" : shaky[u.pageId] ? "slipping" : r < 0.4 ? "weak" : null;
    if (reason) {
      g.weak.push({
        pageId: u.pageId,
        title: u.title,
        r: r,
        reason: reason,
        action: reason === "never tested" ? "quiz" : reason === "slipping" ? "revise" : "open"
      });
    }
  });

  return Object.keys(groups)
    .map((k) => {
      const g = groups[k];
      const rows = [];
      g.pageIds.forEach((pid) => markedRows(pid).forEach((r) => rows.push(r)));

      const scoreMean = weightedMean(rows);
      const scorePct = scoreMean === null ? null : Math.round(scoreMean);
      const coverage = g.topics ? g.examined / g.topics : 0;
      const written = rows.filter((r) => r.kind !== "quiz").length;

      let confidence = "low";
      if (written >= 2 && coverage >= 0.5) confidence = "high";
      else if (written >= 1 || (rows.length >= 3 && coverage >= 0.3)) confidence = "medium";

      const cut = Date.now() - TREND_WINDOW_DAYS * 86400000;
      const recent = rows.filter((r) => r.at >= cut);
      const earlier = rows.filter((r) => r.at < cut);
      let trend = null;
      if (recent.length && earlier.length) {
        const a = weightedMean(recent);
        const b = weightedMean(earlier);
        if (a !== null && b !== null) {
          const delta = Math.round(a - b);
          trend = { delta: delta, dir: delta > TREND_THRESHOLD ? "up" : delta < -TREND_THRESHOLD ? "down" : "flat" };
        }
      }

      g.weak.sort((a, b) => a.r - b.r);

      return {
        id: g.id,
        title: g.title,
        icon: g.icon,
        examDays: g.examDays,
        topics: g.topics,
        examined: g.examined,
        coverage: coverage,
        attempts: rows.length,
        writtenAttempts: written,
        readinessPct: Math.round((g.readinessSum / g.topics) * 100),
        scorePct: scorePct,
        grade: gradeForPercent(scorePct),
        confidence: confidence,
        confidenceNote:
          scorePct === null
            ? "nothing marked yet"
            : g.examined + " of " + g.topics + " topic" + (g.topics === 1 ? "" : "s") + " examined" + (written === 0 ? ", quizzes only" : ""),
        trend: trend,
        loss: lossByQuestionSize(g.pageIds),
        weak: g.weak
      };
    })
    .sort((a, b) => {
      const ea = a.examDays === null ? Infinity : a.examDays;
      const eb = b.examDays === null ? Infinity : b.examDays;
      return ea - eb || a.title.localeCompare(b.title);
    });
}

/** One short line for the collapsed header, or "" when there is nothing to say. */
export function standingSummary(rows) {
  const list = rows || subjectStanding();
  if (!list.length) return "";
  const graded = list.filter((r) => r.grade);
  const bits = [];
  if (graded.length === 1) bits.push("grade " + graded[0].grade + " estimated");
  else if (graded.length > 1) bits.push("grades estimated for " + graded.length + " subjects");
  const untested = list.reduce((n, r) => n + r.topics - r.examined, 0);
  if (untested) bits.push(untested + " topic" + (untested === 1 ? "" : "s") + " never examined");
  if (!bits.length) bits.push(list.length + " subject" + (list.length === 1 ? "" : "s") + " tracked");
  return bits.join(" \u00b7 ");
}
