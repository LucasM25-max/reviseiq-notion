// Spaced repetition engine.
//
// Every toggle block in the workspace is a flashcard: the summary is the
// question, the hidden children are the answer. Review scheduling state lives
// in state.srs, keyed by block id, so notes and scheduling stay in one save.
import { store, getPage, getAllDescendantIds, getAncestors } from "./state.js";
import { pad2, daysUntil } from "./utils.js";

/* Interval ladder in days. Index -1 means "new / relearning". */
export const STEPS = [1, 3, 7, 16, 35];

export function ensureSrs() {
  if (!store.state.srs || typeof store.state.srs !== "object") store.state.srs = {};
  return store.state.srs;
}

export function todayKey() {
  const d = new Date();
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
}

function dateInDays(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
}

export function getRecord(cardId) {
  const srs = ensureSrs();
  return srs[cardId] || null;
}

export function isDue(cardId) {
  const rec = getRecord(cardId);
  if (!rec || !rec.due) return true; // never reviewed
  return rec.due <= todayKey();
}

/** grade: "good" | "almost" | "again" */
export function gradeCard(cardId, grade) {
  const srs = ensureSrs();
  const rec = srs[cardId] || { step: -1, due: null, reps: 0, lapses: 0, last: null };

  if (grade === "good") {
    rec.step = rec.step < 0 ? 0 : Math.min(rec.step + 1, STEPS.length - 1);
    rec.due = dateInDays(STEPS[rec.step]);
  } else if (grade === "almost") {
    rec.step = Math.max(0, rec.step);
    rec.due = dateInDays(1);
  } else {
    rec.step = -1;
    rec.lapses = (rec.lapses || 0) + 1;
    rec.due = todayKey();
  }
  rec.reps = (rec.reps || 0) + 1;
  rec.last = todayKey();
  srs[cardId] = rec;
  logReview();
  return rec;
}

/* ---------- review log (streaks and the weekly graph) ---------- */

export function ensureLog() {
  if (!store.state.reviewLog || typeof store.state.reviewLog !== "object") store.state.reviewLog = {};
  return store.state.reviewLog;
}

function logReview() {
  const log = ensureLog();
  const k = todayKey();
  log[k] = (log[k] || 0) + 1;
}

function dayOffsetKey(n) {
  return dateInDays(-n);
}

/** Cards reviewed today. */
export function reviewedToday() {
  return ensureLog()[todayKey()] || 0;
}

/** Last `days` days, oldest first, for the little bar graph. */
export function weeklyCounts(days) {
  const log = ensureLog();
  const n = days || 7;
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const key = dayOffsetKey(i);
    out.push({ date: key, count: log[key] || 0, isToday: i === 0 });
  }
  return out;
}

/** Consecutive days of revision, counting today (or ending yesterday). */
export function currentStreak() {
  const log = ensureLog();
  let streak = 0;
  let i = log[todayKey()] ? 0 : 1;
  if (i === 1 && !log[dayOffsetKey(1)]) return 0;
  while (log[dayOffsetKey(i)]) {
    streak++;
    i++;
  }
  return streak;
}

/** Human label for when a card will next come round. */
export function nextIntervalLabel(grade, cardId) {
  const rec = getRecord(cardId);
  const step = rec ? rec.step : -1;
  if (grade === "again") return "today";
  if (grade === "almost") return "tomorrow";
  const next = step < 0 ? 0 : Math.min(step + 1, STEPS.length - 1);
  const days = STEPS[next];
  return days === 1 ? "tomorrow" : "in " + days + " days";
}

/* ---------- collecting cards ---------- */

function walkBlocks(blocks, page, out) {
  if (!Array.isArray(blocks)) return;
  blocks.forEach((b) => {
    if (!b || b.type !== "toggle") return;
    const question = String(b.summary || "").replace(/<[^>]+>/g, "").trim();
    if (question) {
      out.push({
        id: b.id,
        pageId: page.id,
        pageTitle: page.title || "Untitled",
        pageIcon: page.icon,
        question: b.summary || "",
        answer: b.children || []
      });
    }
    walkBlocks(b.children, page, out);
  });
}

/** Cards on one page plus all of its subpages. */
export function cardsForPage(pageId) {
  const out = [];
  const ids = [pageId].concat(getAllDescendantIds(pageId));
  ids.forEach((id) => {
    const p = getPage(id);
    if (p) walkBlocks(p.blocks, p, out);
  });
  return out;
}

/** Every card in the workspace. */
export function allCards() {
  const out = [];
  for (const id in store.state.pages) {
    const p = store.state.pages[id];
    walkBlocks(p.blocks, p, out);
  }
  return out;
}

/** Days until the nearest exam of the subject a page belongs to. */
function examUrgency(pageId) {
  const chain = getAncestors(pageId);
  const subject = chain.length ? chain[0] : getPage(pageId);
  if (!subject || !Array.isArray(subject.examDates)) return Infinity;
  let best = Infinity;
  subject.examDates.forEach((ex) => {
    const d = daysUntil(ex.date);
    if (d !== null && d >= 0 && d < best) best = d;
  });
  return best;
}

/**
 * Orders a queue so the most urgent revision comes first: subjects with the
 * soonest exam lead, then the cards that have been waiting longest.
 */
export function sortForRevision(cards) {
  const urgency = {};
  return cards.slice().sort((a, b) => {
    if (!(a.pageId in urgency)) urgency[a.pageId] = examUrgency(a.pageId);
    if (!(b.pageId in urgency)) urgency[b.pageId] = examUrgency(b.pageId);
    if (urgency[a.pageId] !== urgency[b.pageId]) return urgency[a.pageId] - urgency[b.pageId];
    const ra = getRecord(a.id);
    const rb = getRecord(b.id);
    const da = ra && ra.due ? ra.due : "0000-00-00";
    const db = rb && rb.due ? rb.due : "0000-00-00";
    return da < db ? -1 : da > db ? 1 : 0;
  });
}

export function dueCards(cards) {
  return sortForRevision(cards.filter((c) => isDue(c.id)));
}

export function countDueEverywhere() {
  return allCards().filter((c) => isDue(c.id)).length;
}

export function countDueOnPage(pageId) {
  return cardsForPage(pageId).filter((c) => isDue(c.id)).length;
}

/* ---------- dashboard analytics ---------- */

/** The subject (root ancestor) a page belongs to. */
export function subjectOf(pageId) {
  const chain = getAncestors(pageId);
  return chain.length ? chain[0] : getPage(pageId);
}

/** Days until the soonest upcoming exam for a subject page, or null. */
export function subjectExamDays(subject) {
  if (!subject || !Array.isArray(subject.examDates)) return null;
  let best = null;
  subject.examDates.forEach((ex) => {
    const d = daysUntil(ex.date);
    if (d !== null && d >= 0 && (best === null || d < best)) best = d;
  });
  return best;
}

/** Rough minutes for a stack of cards, rounded to the nearest 5. */
export function estimateMinutes(count) {
  const mins = Math.max(5, Math.round((count * 0.75) / 5) * 5);
  return Math.min(mins, 45);
}

/** Due cards grouped by subject, most urgent exam first. */
export function dueBySubject() {
  const groups = {};
  allCards().forEach((card) => {
    if (!isDue(card.id)) return;
    const subject = subjectOf(card.pageId);
    if (!subject) return;
    if (!groups[subject.id]) {
      groups[subject.id] = {
        subjectId: subject.id,
        title: subject.title || "Untitled",
        icon: subject.icon,
        examDays: subjectExamDays(subject),
        cards: []
      };
    }
    groups[subject.id].cards.push(card);
  });
  return Object.keys(groups)
    .map((k) => groups[k])
    .sort((a, b) => {
      const ea = a.examDays === null ? Infinity : a.examDays;
      const eb = b.examDays === null ? Infinity : b.examDays;
      if (ea !== eb) return ea - eb;
      return b.cards.length - a.cards.length;
    });
}

/**
 * Pages you keep getting wrong, ranked by lapse rate. Only pages with enough
 * review history to be meaningful are included, so this stays honest.
 */
export function shakyPages(limit) {
  const byPage = {};
  allCards().forEach((card) => {
    const rec = getRecord(card.id);
    if (!rec || !rec.reps) return;
    const p = byPage[card.pageId] || (byPage[card.pageId] = { pageId: card.pageId, reps: 0, lapses: 0, cards: 0 });
    p.reps += rec.reps;
    p.lapses += rec.lapses || 0;
    p.cards += 1;
  });
  const rows = [];
  for (const id in byPage) {
    const r = byPage[id];
    if (r.reps < 3 || r.lapses === 0) continue;
    const page = getPage(id);
    if (!page) continue;
    const subject = subjectOf(id);
    rows.push({
      pageId: id,
      title: page.title || "Untitled",
      icon: page.icon,
      subjectTitle: subject && subject.id !== id ? subject.title || "Untitled" : "",
      cards: r.cards,
      lapses: r.lapses,
      rate: r.lapses / r.reps
    });
  }
  rows.sort((a, b) => b.rate - a.rate || b.lapses - a.lapses);
  return rows.slice(0, limit || 5);
}

/**
 * Pages with notes but no flashcards, inside a subject whose exam is close.
 * This catches the real failure mode: never having made cards for a topic.
 */
export function pageHasBeenTested(pageId) {
  const quizzes = store.state.quizzes || {};
  for (const k in quizzes) {
    if (quizzes[k] && quizzes[k].pageId === pageId && quizzes[k].result) return true;
  }
  const tests = store.state.tests || {};
  for (const k in tests) {
    if (tests[k] && tests[k].pageId === pageId && tests[k].result) return true;
  }
  const practises = store.state.practises || {};
  for (const k in practises) {
    if (practises[k] && practises[k].pageId === pageId && practises[k].result) return true;
  }
  return false;
}

export function pageWrittenOn(page) {
  if (!page) return false;
  return (page.blocks || []).some((b) => {
    if (!b) return false;
    if (b.type === "page" || b.type === "divider") return false;
    return String(b.content || "").replace(/<[^>]+>/g, "").trim().length > 0;
  });
}

/**
 * Pages with notes that have never been examined in any way: no flashcards,
 * no quiz, no mock paper. Having no flashcards on its own is NOT a gap -
 * cards are meant to be generated from what you get wrong, so a topic you
 * have quizzed and passed needs no cards written for it.
 */
export function coverageGaps(withinDays, limit) {
  const horizon = withinDays === undefined ? 30 : withinDays;
  const rows = [];
  for (const id in store.state.pages) {
    const page = store.state.pages[id];
    const subject = subjectOf(id);
    const days = subjectExamDays(subject);
    if (days === null || days > horizon) continue;
    if (cardsForPage(id).length > 0) continue;
    if (pageHasBeenTested(id)) continue;
    if (!pageWrittenOn(page)) continue;
    rows.push({
      pageId: id,
      title: page.title || "Untitled",
      icon: page.icon,
      subjectTitle: subject && subject.id !== id ? subject.title || "Untitled" : "",
      examDays: days
    });
  }
  rows.sort((a, b) => a.examDays - b.examDays);
  return rows.slice(0, limit || 5);
}

/** Mean position on the interval ladder for a set of cards, 0..1. */
export function maturityOf(cards) {
  if (!cards.length) return 0;
  let sum = 0;
  cards.forEach((c) => {
    const rec = getRecord(c.id);
    const step = rec && typeof rec.step === "number" ? rec.step : -1;
    sum += step < 0 ? 0 : (step + 1) / STEPS.length;
  });
  return sum / cards.length;
}

/** Share of reviews forgotten across a set of cards, 0..1 (null if untested). */
export function lapseRateOf(cards) {
  let reps = 0;
  let lapses = 0;
  cards.forEach((c) => {
    const rec = getRecord(c.id);
    if (!rec) return;
    reps += rec.reps || 0;
    lapses += rec.lapses || 0;
  });
  if (reps < 2) return null;
  return lapses / reps;
}

/**
 * Builds today's plan: at most four concrete blocks of work, ordered by how
 * close the exam is. Returns an empty array when there is genuinely nothing
 * to do — the dashboard says so rather than inventing filler.
 */
export function buildTodayPlan(maxItems) {
  const cap = maxItems || 4;
  const plan = [];

  dueBySubject().forEach((group) => {
    if (plan.length >= cap) return;
    plan.push({
      kind: "due",
      pageId: group.subjectId,
      title: group.title,
      icon: group.icon,
      count: group.cards.length,
      minutes: estimateMinutes(group.cards.length),
      examDays: group.examDays,
      detail:
        group.cards.length + " card" + (group.cards.length === 1 ? "" : "s") + " due" +
        (group.examDays !== null
          ? " \u00B7 exam in " + group.examDays + " day" + (group.examDays === 1 ? "" : "s")
          : "")
    });
  });

  if (plan.length < cap) {
    const shaky = shakyPages(1)[0];
    if (shaky && !plan.some((p) => p.pageId === shaky.pageId)) {
      plan.push({
        kind: "shaky",
        pageId: shaky.pageId,
        title: shaky.title,
        icon: shaky.icon,
        count: shaky.cards,
        minutes: estimateMinutes(shaky.cards),
        detail: "You keep slipping on this one \u00B7 " + shaky.lapses + " lapse" + (shaky.lapses === 1 ? "" : "s")
      });
    }
  }

  if (plan.length < cap) {
    const gap = coverageGaps(30, 1)[0];
    if (gap) {
      plan.push({
        kind: "gap",
        pageId: gap.pageId,
        title: gap.title,
        icon: gap.icon,
        count: 0,
        minutes: 10,
        detail: "Notes but no flashcards \u00B7 exam in " + gap.examDays + " day" + (gap.examDays === 1 ? "" : "s")
      });
    }
  }

  return plan;
}
