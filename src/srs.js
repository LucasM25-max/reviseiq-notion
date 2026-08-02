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
  return rec;
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
