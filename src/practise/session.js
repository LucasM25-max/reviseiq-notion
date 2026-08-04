/*
 * "Practise" - the middle rung between Quiz me and Test me.
 *
 * Ten to twenty-five minutes of written work. It always starts with hard
 * open-ended knowledge questions typed into text areas, and then - only on
 * pages whose exam structure is actually known - moves on to real exam
 * questions, taken from the same registry and written by the same generator
 * the mock papers use.
 *
 * Where the exam structure is not known, no exam questions are invented.
 * The knowledge stage simply runs longer and the practise ends there.
 */
import { getPage, getChildren } from "../state.js";
import { escapeHtml, uid } from "../utils.js";
import { scheduleSave } from "../storage.js";
import { ui } from "../icons.js";
import { collectNotes, subjectAncestor } from "../exam/notes.js";
import { testEligibility } from "../exam/session.js";
import {
  MIN_PRACTISE_WORDS,
  MAX_TOTAL_MINUTES,
  TARGET_CHOICES,
  DEFAULT_TARGET_MINUTES,
  clampTarget,
  planKnowledge,
  examBudgetMinutes,
  selectExamQuestions,
  allowedMinutes
} from "./prompt.js";
import { COMPONENTS } from "../exam/aqaHistory.js";
import {
  savePractiseAttempt,
  getPractiseAttempt,
  unfinishedPractiseForPage,
  recordPractiseInsights,
  missesFromPractise
} from "./store.js";
import { authHeaders } from "../cloud/auth.js";
import { generateFlashcardsFromMisses } from "../quiz/flashcards.js";
import { completeTaskForPage } from "../plan/store.js";

let session = null; // { attempt, view, error, tickId, saveId }
let onClose = () => {};

export function setPractiseCloseHandler(fn) {
  onClose = fn;
}

export function practiseActive() {
  return Boolean(session);
}

/* ------------------------------------------------------------------ *
 * Eligibility
 * ------------------------------------------------------------------ */

/**
 * The exam stage, or null. This is deliberately strict: it exists only where a
 * real specification is in the registry and the notes are substantial enough to
 * examine. Nothing here ever guesses at the shape of an exam.
 */
export function examStageFor(pageId) {
  const el = testEligibility(pageId);
  if (!el || !el.enough || !el.option) return null;
  const component = COMPONENTS[el.option.componentId];
  if (!component) return null;
  return {
    componentId: component.id,
    optionId: el.option.id,
    componentShort: component.short,
    componentLabel: component.label,
    optionLabel: el.option.label,
    site: el.site || ""
  };
}

export function practiseEligibility(pageId) {
  const page = getPage(pageId);
  if (!page) return null;
  const hasChildren = getChildren(pageId).length > 0;
  const notes = collectNotes(pageId, false);
  const treeWords = hasChildren ? collectNotes(pageId, true).wordCount : notes.wordCount;
  return {
    pageId,
    page,
    hasChildren,
    words: notes.wordCount,
    treeWords,
    exam: examStageFor(pageId),
    enough: notes.wordCount >= MIN_PRACTISE_WORDS || treeWords >= MIN_PRACTISE_WORDS
  };
}

/* What a given length will actually contain, for the setup card. */
export function shapeOf(targetMinutes, exam) {
  const target = clampTarget(targetMinutes);
  const knowledge = planKnowledge(target, Boolean(exam));
  let examQuestions = [];
  if (exam) {
    const component = COMPONENTS[exam.componentId];
    examQuestions = selectExamQuestions(
      component.questions,
      examBudgetMinutes(target),
      MAX_TOTAL_MINUTES - knowledge.minutes
    );
  }
  const examMinutes = examQuestions.reduce((s, q) => s + q.minutes, 0);
  const examMarks = examQuestions.reduce((s, q) => s + q.marks + (q.spag || 0), 0);
  return {
    target,
    knowledge,
    examQuestions,
    examMinutes,
    examMarks,
    total: allowedMinutes(knowledge.minutes, examMinutes)
  };
}

/* ------------------------------------------------------------------ *
 * Setup card
 * ------------------------------------------------------------------ */

export function openPractiseSetup(pageId) {
  const el = practiseEligibility(pageId);
  if (!el) return;

  const existing = unfinishedPractiseForPage(pageId);
  const modal = document.createElement("div");
  modal.className = "modal-overlay practise-setup-overlay";
  modal.id = "practise-setup";
  modal.innerHTML = renderSetup(el, existing, DEFAULT_TARGET_MINUTES);
  document.getElementById("overlay-root").appendChild(modal);

  modal.addEventListener("mousedown", (e) => {
    if (e.target === modal) modal.remove();
  });

  modal.addEventListener("click", (e) => {
    const lenBtn = e.target.closest("[data-practise-len]");
    if (lenBtn) {
      modal.querySelectorAll("[data-practise-len]").forEach((b) => b.classList.remove("is-on"));
      lenBtn.classList.add("is-on");
      const box = modal.querySelector("#practise-shape");
      if (box) box.innerHTML = renderShape(Number(lenBtn.dataset.practiseLen), el.exam);
      return;
    }

    const btn = e.target.closest("[data-practise-setup]");
    if (!btn) return;
    const act = btn.dataset.practiseSetup;

    if (act === "cancel") {
      modal.remove();
      return;
    }
    if (act === "resume") {
      modal.remove();
      resumePractise(btn.dataset.practiseId);
      return;
    }
    if (act === "discard") {
      const a = getPractiseAttempt(btn.dataset.practiseId);
      if (a) {
        a.status = "abandoned";
        savePractiseAttempt(a);
      }
      modal.remove();
      openPractiseSetup(pageId);
      return;
    }
    if (act !== "start") return;

    const scopeEl = modal.querySelector('input[name="practise-scope"]:checked');
    const includeSubpages = scopeEl ? scopeEl.value === "tree" : false;
    const chosen = modal.querySelector("[data-practise-len].is-on");
    const target = chosen ? Number(chosen.dataset.practiseLen) : DEFAULT_TARGET_MINUTES;

    modal.remove();
    startPractise({ pageId, includeSubpages, targetMinutes: target });
  });
}

function renderSetup(el, existing, target) {
  const pageNotes = collectNotes(el.pageId, false);
  const treeNotes = el.hasChildren ? collectNotes(el.pageId, true) : pageNotes;

  let html = '<div class="modal practise-setup">';
  html +=
    '<div class="practise-setup-head">' +
    '<div class="practise-setup-badge">' + ui("marksheet", 15) + "Written practice</div>" +
    "<h3>Practise</h3>" +
    "<p>A short written test: hard knowledge questions you answer in your own words, marked against a mark scheme.</p>" +
    "</div>";

  if (existing) {
    html +=
      '<div class="practise-resume">' +
      "<div><strong>You have an unfinished practise.</strong><span>" +
      escapeHtml(existing.title || "") +
      "</span></div>" +
      '<div class="practise-resume-actions">' +
      '<button class="btn-ghost" data-practise-setup="discard" data-practise-id="' + existing.id + '">Discard</button>' +
      '<button class="btn-primary" data-practise-setup="resume" data-practise-id="' + existing.id + '">Resume</button>' +
      "</div></div>";
  }

  html += '<label class="practise-field-label">What should it cover?</label>';
  html += '<div class="practise-scope">';
  html += scopeRow("page", "Just this page", pageNotes, true, true);
  html += scopeRow("tree", "This page and its subpages", treeNotes, el.hasChildren, false);
  html += "</div>";

  html += '<label class="practise-field-label">How long have you got?</label>';
  html += '<div class="practise-len">';
  TARGET_CHOICES.forEach((n) => {
    html +=
      '<button class="practise-len-btn' + (n === target ? " is-on" : "") + '" data-practise-len="' + n + '">' +
      n + " min</button>";
  });
  html += "</div>";

  html += '<div id="practise-shape">' + renderShape(target, el.exam) + "</div>";

  if (!el.enough) {
    html +=
      '<div class="practise-warn">There are only ' + el.words +
      " words on this page. Add more notes first, or include your subpages.</div>";
  }

  html +=
    '<div class="modal-actions">' +
    '<button class="btn-cancel" data-practise-setup="cancel">Cancel</button>' +
    '<button class="btn-primary" data-practise-setup="start">Start practise</button>' +
    "</div></div>";
  return html;
}

/* The honest description of what this practise will be, before it is written. */
function renderShape(target, exam) {
  const shape = shapeOf(target, exam);
  let html = '<div class="practise-shape">';

  html +=
    '<div class="practise-stage-row">' +
    '<div class="practise-stage-num">1</div>' +
    "<div><strong>" + shape.knowledge.count + " knowledge questions</strong>" +
    '<span class="practise-stage-meta">about ' + shape.knowledge.marks + " marks \u00b7 " +
    shape.knowledge.minutes + " min \u00b7 typed answers, two to six sentences each</span></div></div>";

  if (exam && shape.examQuestions.length) {
    html +=
      '<div class="practise-stage-row">' +
      '<div class="practise-stage-num">2</div>' +
      "<div><strong>" + shape.examQuestions.length + " exam question" +
      (shape.examQuestions.length === 1 ? "" : "s") + "</strong>" +
      '<span class="practise-stage-meta">' + shape.examMarks + " marks \u00b7 " + shape.examMinutes +
      " min \u00b7 " + escapeHtml(exam.componentShort) + ", written and marked exactly as in Test me</span></div></div>";
  } else {
    html +=
      '<div class="practise-stage-none">' + ui("warning", 13) +
      "<span>No exam questions in this one. ReviseIQ only sets exam questions where it knows the real structure of the paper \u2014 currently AQA GCSE History. " +
      "Instead, the knowledge stage is longer.</span></div>";
  }

  html +=
    '<div class="practise-total">' + ui("stopwatch", 13) +
    "<span>About <strong>" + shape.total + " minutes</strong>, worked out from the marks. " +
    "It stops for good at " + MAX_TOTAL_MINUTES + " minutes.</span></div>";

  html += "</div>";
  return html;
}

function scopeRow(value, label, notes, enabled, checked) {
  const pages = notes.pages.length;
  return (
    '<label class="practise-scope-row' + (enabled ? "" : " is-off") + '">' +
    '<input type="radio" name="practise-scope" value="' + value + '"' +
    (checked ? " checked" : "") + (enabled ? "" : " disabled") + " />" +
    "<span><strong>" + escapeHtml(label) + "</strong>" +
    '<span class="practise-scope-meta">' + notes.wordCount + " words" +
    (pages > 1 ? " \u00b7 " + pages + " pages" : "") + "</span></span></label>"
  );
}

/* ------------------------------------------------------------------ *
 * Overlay plumbing
 * ------------------------------------------------------------------ */

function overlayEl() {
  return document.getElementById("practise-overlay");
}

function mountOverlay(fullscreen) {
  let overlay = overlayEl();
  if (overlay) return overlay;
  overlay = document.createElement("div");
  overlay.className = "practise-overlay";
  overlay.id = "practise-overlay";
  document.getElementById("overlay-root").appendChild(overlay);
  overlay.addEventListener("click", handleOverlayClick);
  overlay.addEventListener("input", handleOverlayInput);
  document.addEventListener("keydown", handleKey, true);
  if (fullscreen) requestFullscreen(overlay);
  else exitFullscreen();
  return overlay;
}

function requestFullscreen(el) {
  try {
    const fn = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
    if (fn) {
      const p = fn.call(el, { navigationUI: "hide" });
      if (p && p.catch) p.catch(() => {});
    }
  } catch (e) {
    /* refused - the overlay still covers the app */
  }
}

function exitFullscreen() {
  try {
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      const fn = document.exitFullscreen || document.webkitExitFullscreen;
      if (fn) {
        const p = fn.call(document);
        if (p && p.catch) p.catch(() => {});
      }
    }
  } catch (e) {
    /* ignore */
  }
}

/* The questions as one ordered list, knowledge first, then any exam questions. */
function itemsOf(attempt) {
  const p = attempt.practise;
  if (!p) return [];
  const items = (p.knowledge.questions || []).map((q) => ({ stage: "knowledge", q }));
  if (p.exam) (p.exam.questions || []).forEach((q) => items.push({ stage: "exam", q }));
  return items;
}

function answerOf(attempt, item) {
  const bag = attempt.answers[item.stage] || {};
  return bag[String(item.q.number)] || "";
}

function setAnswer(attempt, item, text) {
  if (!attempt.answers[item.stage]) attempt.answers[item.stage] = {};
  attempt.answers[item.stage][String(item.q.number)] = text;
}

/* ------------------------------------------------------------------ *
 * Running a practise
 * ------------------------------------------------------------------ */

export async function startPractise(cfg) {
  const page = getPage(cfg.pageId);
  if (!page) return;
  const subject = subjectAncestor(cfg.pageId);
  const notes = collectNotes(cfg.pageId, cfg.includeSubpages);
  const exam = examStageFor(cfg.pageId);
  const target = clampTarget(cfg.targetMinutes);

  const attempt = {
    id: uid(),
    pageId: cfg.pageId,
    pageTitle: page.title || "Untitled",
    subjectTitle: subject ? subject.title || "" : "",
    includeSubpages: !!cfg.includeSubpages,
    targetMinutes: target,
    title: page.title || "Practise",
    status: "generating",
    startedAt: Date.now(),
    resumedAt: null,
    finishedAt: null,
    elapsedSeconds: 0,
    allowedMinutes: target,
    index: 0,
    answers: { knowledge: {}, exam: {} },
    practise: null,
    result: null,
    cardsMade: 0,
    overran: false
  };

  session = { attempt, view: "generating", error: null, tickId: null };
  mountOverlay(true);
  paint();

  try {
    const res = await postJson("/api/practise/generate", {
      pageTitle: page.title || "Untitled",
      subjectTitle: attempt.subjectTitle,
      includedPages: notes.pages,
      notes: notes.text,
      targetMinutes: target,
      // The exam stage is requested only where a real specification is known.
      exam: exam ? { componentId: exam.componentId, optionId: exam.optionId, site: exam.site } : null
    });
    if (!session || session.attempt.id !== attempt.id) return; // closed while waiting
    attempt.practise = res.practise;
    attempt.title = res.practise.title || attempt.title;
    attempt.allowedMinutes = res.practise.allowedMinutes || target;
    attempt.status = "in-progress";
    attempt.startedAt = Date.now();
    savePractiseAttempt(attempt);
    session.view = "practise";
    startTick();
    paint();
  } catch (e) {
    if (!session) return;
    session.view = "error";
    session.error = e.message;
    paint();
  }
}

export function resumePractise(practiseId) {
  const attempt = getPractiseAttempt(practiseId);
  if (!attempt) return;
  if (attempt.status === "marked") {
    openPractiseResults(practiseId);
    return;
  }
  session = { attempt, view: "practise", error: null, tickId: null };
  attempt.resumedAt = Date.now();
  mountOverlay(true);
  startTick();
  paint();
}

export function openPractiseResults(practiseId) {
  const attempt = getPractiseAttempt(practiseId);
  if (!attempt || !attempt.result) return;
  stopTick();
  session = { attempt, view: "results", error: null, tickId: null };
  mountOverlay(false);
  paint();
}

/*
 * The clock. The target is a guide, not a gate: overrunning it is allowed and
 * simply recorded. The hard limit is the one thing that is enforced, because a
 * practise that drags on for an hour is no longer a practise.
 */
function startTick() {
  stopTick();
  session.tickId = setInterval(() => {
    if (!session || session.view !== "practise") return;
    const secs = elapsed();
    const el = document.getElementById("practise-elapsed");
    if (el) el.textContent = clock(secs);

    const a = session.attempt;
    const over = secs > (a.allowedMinutes || 0) * 60;
    if (over && !a.overran) {
      a.overran = true;
      const note = document.getElementById("practise-over");
      if (note) note.hidden = false;
      const bar = document.querySelector(".pr-bar");
      if (bar) bar.classList.add("is-over");
    }
    if (secs >= MAX_TOTAL_MINUTES * 60) finish(true);
  }, 1000);
}

function stopTick() {
  if (session && session.tickId) clearInterval(session.tickId);
  if (session) session.tickId = null;
}

function elapsed() {
  if (!session) return 0;
  const a = session.attempt;
  const base = a.elapsedSeconds || 0;
  const from = a.resumedAt || a.startedAt;
  return base + Math.max(0, Math.round((Date.now() - from) / 1000));
}

function clock(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
}

export function closePractise(force) {
  if (!session) return;
  const a = session.attempt;
  if (!force && a.status === "in-progress") {
    const el = document.getElementById("practise-leave");
    if (el) {
      el.hidden = false;
      return;
    }
  }
  if (a.status === "in-progress") {
    a.elapsedSeconds = elapsed();
    a.resumedAt = null;
    savePractiseAttempt(a);
  }
  stopTick();
  exitFullscreen();
  const overlay = overlayEl();
  if (overlay) overlay.remove();
  document.removeEventListener("keydown", handleKey, true);
  session = null;
  scheduleSave();
  onClose();
}

/* ------------------------------------------------------------------ *
 * Input
 * ------------------------------------------------------------------ */

function handleKey(e) {
  if (!session) return;
  if (e.key === "Escape") {
    e.preventDefault();
    if (session.view === "practise") {
      const el = document.getElementById("practise-leave");
      if (el) el.hidden = false;
      return;
    }
    closePractise(true);
    return;
  }
  // Everything else is typing, so only the explicit shortcuts are taken.
  if (session.view !== "practise") return;
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    e.preventDefault();
    step(1);
  }
}

function handleOverlayInput(e) {
  if (!session || !session.attempt.practise) return;
  const box = e.target.closest("[data-practise-answer]");
  if (!box) return;
  const items = itemsOf(session.attempt);
  const item = items[session.attempt.index];
  if (!item) return;
  setAnswer(session.attempt, item, box.value);

  const words = box.value.trim() ? box.value.trim().split(/\s+/).length : 0;
  const meter = document.getElementById("practise-words");
  if (meter) meter.textContent = words + (words === 1 ? " word" : " words");
  const dot = document.querySelector('.pr-dot[data-i="' + session.attempt.index + '"]');
  if (dot) dot.classList.toggle("is-done", words > 0);

  // Written work is saved as it is typed, so nothing is ever lost.
  if (session.saveId) clearTimeout(session.saveId);
  session.saveId = setTimeout(() => {
    if (session) savePractiseAttempt(session.attempt);
  }, 600);
}

function handleOverlayClick(e) {
  if (!session) return;

  const dot = e.target.closest("[data-practise-jump]");
  if (dot) {
    goTo(Number(dot.dataset.practiseJump));
    return;
  }

  const btn = e.target.closest("[data-practise-act]");
  if (!btn) return;
  const act = btn.dataset.practiseAct;

  if (act === "next") step(1);
  else if (act === "prev") step(-1);
  else if (act === "finish") askFinish();
  else if (act === "finish-confirm") finish(false);
  else if (act === "finish-cancel") {
    const el = document.getElementById("practise-finish");
    if (el) el.hidden = true;
  } else if (act === "leave-cancel") {
    const el = document.getElementById("practise-leave");
    if (el) el.hidden = true;
  } else if (act === "leave") closePractise(true);
  else if (act === "close") closePractise(false);
  else if (act === "retry") {
    const a = session.attempt;
    closePractise(true);
    startPractise({ pageId: a.pageId, includeSubpages: a.includeSubpages, targetMinutes: a.targetMinutes });
  } else if (act === "mark-again") finish(false);
  else if (act === "cards") runFlashcards();
  else if (act === "sources") {
    const panel = document.getElementById("practise-sources");
    if (panel) panel.hidden = !panel.hidden;
    btn.classList.toggle("is-open");
  }
}

function commitCurrent() {
  const box = document.querySelector("[data-practise-answer]");
  if (!box || !session) return;
  const items = itemsOf(session.attempt);
  const item = items[session.attempt.index];
  if (item) setAnswer(session.attempt, item, box.value);
}

function goTo(index) {
  if (!session) return;
  const items = itemsOf(session.attempt);
  if (index < 0 || index >= items.length) return;
  commitCurrent();
  session.attempt.index = index;
  savePractiseAttempt(session.attempt);
  paint();
}

function step(delta) {
  if (!session) return;
  const items = itemsOf(session.attempt);
  const next = session.attempt.index + delta;
  if (next >= items.length) {
    askFinish();
    return;
  }
  goTo(next);
}

function askFinish() {
  commitCurrent();
  const el = document.getElementById("practise-finish");
  if (el) {
    el.hidden = false;
    return;
  }
  finish(false);
}

/* ------------------------------------------------------------------ *
 * Marking
 * ------------------------------------------------------------------ */

async function finish(auto) {
  if (!session) return;
  const a = session.attempt;
  if (session.view === "marking") return;
  commitCurrent();
  stopTick();

  if (a.status === "in-progress") {
    a.elapsedSeconds = elapsed();
    a.resumedAt = null;
  }
  a.finishedAt = Date.now();
  a.autoSubmitted = !!auto;
  a.status = "marking";
  session.view = "marking";
  session.error = null;
  savePractiseAttempt(a);
  exitFullscreen();
  paint();

  const p = a.practise;
  const body = {
    pageTitle: a.pageTitle,
    subjectTitle: a.subjectTitle,
    timeUsedSeconds: a.elapsedSeconds || 0,
    knowledge: {
      questions: p.knowledge.questions,
      answers: a.answers.knowledge || {}
    },
    exam: p.exam
      ? {
          componentId: p.exam.componentId,
          optionId: p.exam.optionId,
          componentShort: p.exam.componentShort,
          paperTitle: p.exam.paperTitle,
          sectionTitle: p.exam.sectionTitle,
          site: p.exam.site,
          sources: p.exam.sources,
          questions: p.exam.questions,
          answers: a.answers.exam || {}
        }
      : null
  };

  let res;
  try {
    res = await postJson("/api/practise/mark", body);
  } catch (e) {
    if (!session || session.attempt.id !== a.id) return;
    // The answers are safe. Only the marking failed, so it can be retried.
    a.status = "in-progress";
    a.resumedAt = Date.now();
    savePractiseAttempt(a);
    session.view = "mark-error";
    session.error = e.message;
    paint();
    return;
  }
  if (!session || session.attempt.id !== a.id) return;

  a.result = res.result;
  a.status = "marked";
  savePractiseAttempt(a);
  recordPractiseInsights(a);
  // A practise is retrieval practice, so it settles the same slots in the plan
  // that a quiz or a read-through would.
  try {
    completeTaskForPage(a.pageId, ["practise", "quiz", "read"]);
  } catch (e) {
    /* the plan is optional - never let it break marking */
  }
  session.view = "results";
  paint();

  runFlashcards();
}

/* Cards are written from what was actually missed, without being asked for. */
async function runFlashcards() {
  if (!session) return;
  const a = session.attempt;
  if (!a.result) return;
  const misses = missesFromPractise(a);
  if (!misses.length) {
    a.result.cardState = "none";
    savePractiseAttempt(a);
    paint();
    return;
  }

  a.result.cardState = "loading";
  a.result.cardError = null;
  paint();

  const out = await generateFlashcardsFromMisses({
    pageId: a.pageId,
    pageTitle: a.pageTitle,
    subjectTitle: a.subjectTitle,
    source: "test",
    includeSubpages: !!a.includeSubpages,
    attemptId: a.id,
    misses
  });

  if (!session || session.attempt.id !== a.id) return;
  a.cardsMade = (a.cardsMade || 0) + out.made;
  a.cardsResurfaced = out.resurfaced || 0;
  a.result.cardsAiWritten = out.aiUsed;
  a.result.cardState = out.made || out.resurfaced ? "done" : "error";
  a.result.cardError =
    out.made || out.resurfaced ? null : out.error || "Couldn\u2019t write flashcards from this one.";
  savePractiseAttempt(a);
  scheduleSave();
  paint();
}

/* ------------------------------------------------------------------ *
 * Network
 * ------------------------------------------------------------------ */

async function postJson(url, body) {
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify(body)
    });
  } catch (e) {
    throw new Error("No connection to the server. Practise needs to be online.");
  }
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    /* fall through */
  }
  if (!res.ok || !data || data.error) {
    throw new Error((data && data.error) || "The server returned an error (" + res.status + ").");
  }
  return data;
}

/* ------------------------------------------------------------------ *
 * Painting
 * ------------------------------------------------------------------ */

function paint() {
  const overlay = overlayEl();
  if (!overlay || !session) return;

  if (session.view === "generating") {
    overlay.innerHTML = renderBusy(
      "Writing your practise",
      "Reading your notes and setting questions worth answering."
    );
    return;
  }
  if (session.view === "marking") {
    overlay.innerHTML = renderBusy("Marking your answers", "Marking against the mark scheme, point by point.");
    return;
  }
  if (session.view === "error") {
    overlay.innerHTML = renderError(session.error, true);
    return;
  }
  if (session.view === "mark-error") {
    overlay.innerHTML = renderError(session.error, false);
    return;
  }
  if (session.view === "results") {
    overlay.innerHTML = renderResults();
    return;
  }
  overlay.innerHTML = renderPractise();
  const box = overlay.querySelector("[data-practise-answer]");
  if (box) {
    box.focus();
    box.setSelectionRange(box.value.length, box.value.length);
  }
}

function renderBusy(title, sub) {
  return (
    '<div class="pr-shell pr-centred">' +
    '<div class="pr-busy"><div class="pr-spinner"></div>' +
    "<h2>" + escapeHtml(title) + "</h2><p>" + escapeHtml(sub) + "</p>" +
    '<button class="btn-ghost" data-practise-act="close">Cancel</button>' +
    "</div></div>"
  );
}

function renderError(message, canRetry) {
  return (
    '<div class="pr-shell pr-centred">' +
    '<div class="pr-busy">' +
    '<div class="pr-error-icon">' + ui("warning", 26) + "</div>" +
    "<h2>That didn\u2019t work</h2>" +
    "<p>" + escapeHtml(message || "Something went wrong.") + "</p>" +
    (canRetry
      ? '<p class="pr-error-note">Nothing has been saved.</p>'
      : '<p class="pr-error-note">Your answers are saved \u2014 you can mark them again.</p>') +
    '<div class="pr-actions">' +
    '<button class="btn-ghost" data-practise-act="close">Close</button>' +
    (canRetry
      ? '<button class="btn-primary" data-practise-act="retry">Try again</button>'
      : '<button class="btn-primary" data-practise-act="mark-again">Mark again</button>') +
    "</div></div></div>"
  );
}

function stageLabelFor(attempt, item) {
  if (item.stage === "knowledge") return "Knowledge";
  const exam = attempt.practise.exam;
  return exam ? exam.componentShort : "Exam";
}

function renderPractise() {
  const a = session.attempt;
  const items = itemsOf(a);
  const item = items[a.index] || items[0];
  if (!item) return renderError("This practise has no questions.", true);

  const exam = a.practise.exam;
  const answer = answerOf(a, item);
  const words = answer.trim() ? answer.trim().split(/\s+/).length : 0;
  const isExam = item.stage === "exam";
  const marks = item.q.marks + (isExam ? item.q.spagMarks || 0 : 0);
  const knowledgeCount = a.practise.knowledge.questions.length;
  const number = isExam ? a.index - knowledgeCount + 1 : item.q.number;

  let html = '<div class="pr-shell">';

  /* --- bar --- */
  html +=
    '<div class="pr-bar' + (a.overran ? " is-over" : "") + '">' +
    '<div class="pr-bar-left">' +
    '<div class="pr-bar-title">' + escapeHtml(a.title) + "</div>" +
    '<div class="pr-bar-sub">Practise \u00b7 about ' + a.allowedMinutes + " min</div>" +
    "</div>" +
    '<div class="pr-bar-right">' +
    '<div class="pr-elapsed" id="practise-elapsed">' + clock(elapsed()) + "</div>" +
    '<button class="btn-primary pr-finish" data-practise-act="finish">Finish</button>' +
    '<button class="pr-close" data-practise-act="close" aria-label="Close">' + ui("close", 16) + "</button>" +
    "</div></div>";

  /* --- progress dots, split by stage --- */
  html += '<div class="pr-dots">';
  items.forEach((it, i) => {
    const done = answerOf(a, it).trim().length > 0;
    if (i === knowledgeCount) html += '<span class="pr-dot-split"></span>';
    html +=
      '<button class="pr-dot' + (i === a.index ? " is-current" : "") + (done ? " is-done" : "") +
      (it.stage === "exam" ? " is-exam" : "") + '" data-i="' + i + '" data-practise-jump="' + i +
      '" aria-label="Question ' + (i + 1) + '"></button>';
  });
  html += "</div>";

  /* --- overrun notice --- */
  html +=
    '<div class="pr-over" id="practise-over"' + (a.overran ? "" : " hidden") + ">" +
    ui("stopwatch", 13) +
    "<span>You\u2019re past the " + a.allowedMinutes + " minutes this was worth. Finish up \u2014 it stops at " +
    MAX_TOTAL_MINUTES + " minutes.</span></div>";

  /* --- the question --- */
  html += '<div class="pr-body">';

  if (isExam && a.index === knowledgeCount) {
    html +=
      '<div class="pr-stage-banner">' + ui("exam", 15) +
      "<div><strong>Now the exam questions.</strong><span>" +
      escapeHtml(exam.paperTitle + " \u2014 " + exam.sectionTitle) +
      ". Same questions, same marks and same mark scheme as a mock paper.</span></div></div>";
  }

  if (isExam && exam.sources && exam.sources.length) {
    html +=
      '<button class="pr-sources-toggle" data-practise-act="sources">' + ui("chevronRight", 13) +
      "Sources and interpretations</button>" +
      '<div class="pr-sources" id="practise-sources" hidden>' +
      exam.sources
        .map(
          (s) =>
            '<div class="pr-source"><div class="pr-source-label">' + escapeHtml(s.label) + "</div>" +
            '<div class="pr-source-prov">' + escapeHtml(s.provenance) + "</div>" +
            '<div class="pr-source-body">' + escapeHtml(s.body) + "</div>" +
            '<div class="pr-source-note">Written for this practise, not a genuine archive extract.</div></div>'
        )
        .join("") +
      "</div>";
  }

  html +=
    '<div class="pr-card' + (isExam ? " is-exam" : "") + '">' +
    '<div class="pr-q-head">' +
    '<span class="pr-q-stage">' + escapeHtml(stageLabelFor(a, item)) + "</span>" +
    '<span class="pr-q-num">Question ' + number + "</span>" +
    '<span class="pr-q-marks">' + marks + " mark" + (marks === 1 ? "" : "s") +
    (isExam && item.q.spagMarks ? " (incl. " + item.q.spagMarks + " SPaG)" : "") + "</span>" +
    (isExam && item.q.guidanceMinutes
      ? '<span class="pr-q-time">' + item.q.guidanceMinutes + " min in the real paper</span>"
      : "") +
    "</div>" +
    '<div class="pr-q-text">' + escapeHtml(isExam ? item.q.stem : item.q.prompt) + "</div>" +
    (!isExam && item.q.topic
      ? '<div class="pr-q-topic">' + escapeHtml(item.q.topic) + "</div>"
      : "") +
    '<textarea class="pr-answer" data-practise-answer rows="' + (isExam ? 16 : 8) +
    '" placeholder="' + (isExam ? "Write your answer as you would in the exam\u2026" : "Answer in your own words\u2026") +
    '">' + escapeHtml(answer) + "</textarea>" +
    '<div class="pr-card-foot">' +
    '<span class="pr-words" id="practise-words">' + words + (words === 1 ? " word" : " words") + "</span>" +
    '<span class="pr-hint">Ctrl + Enter for the next question</span>' +
    "</div></div>";

  html += "</div>";

  /* --- nav --- */
  html +=
    '<div class="pr-nav">' +
    '<button class="btn-ghost"' + (a.index === 0 ? " disabled" : "") + ' data-practise-act="prev">Back</button>' +
    '<span class="pr-nav-count">' + (a.index + 1) + " of " + items.length + "</span>" +
    (a.index === items.length - 1
      ? '<button class="btn-primary" data-practise-act="finish">Finish and mark</button>'
      : '<button class="btn-primary" data-practise-act="next">Next</button>') +
    "</div>";

  /* --- confirmations --- */
  const blank = items.filter((it) => !answerOf(a, it).trim()).length;
  html +=
    '<div class="pr-confirm" id="practise-finish" hidden><div class="pr-confirm-card">' +
    "<h3>Finish and mark?</h3>" +
    "<p>" +
    (blank
      ? blank + " question" + (blank === 1 ? " is" : "s are") + " still blank. Blank answers score zero."
      : "All questions answered.") +
    "</p>" +
    '<div class="modal-actions">' +
    '<button class="btn-cancel" data-practise-act="finish-cancel">Keep writing</button>' +
    '<button class="btn-primary" data-practise-act="finish-confirm">Mark it</button>' +
    "</div></div></div>";

  html +=
    '<div class="pr-confirm" id="practise-leave" hidden><div class="pr-confirm-card">' +
    "<h3>Leave this practise?</h3>" +
    "<p>Your answers are saved. You can pick it up from the page whenever you like.</p>" +
    '<div class="modal-actions">' +
    '<button class="btn-cancel" data-practise-act="leave-cancel">Stay</button>' +
    '<button class="btn-danger" data-practise-act="leave">Leave</button>' +
    "</div></div></div>";

  html += "</div>";
  return html;
}

function renderResults() {
  const a = session.attempt;
  const r = a.result;
  const p = a.practise;
  const pct = r.percentage || 0;
  const mins = Math.round((a.elapsedSeconds || 0) / 60);

  let html = '<div class="pr-shell pr-results">';

  html +=
    '<div class="pr-bar">' +
    '<div class="pr-bar-left">' +
    '<div class="pr-bar-title">' + escapeHtml(a.title) + "</div>" +
    '<div class="pr-bar-sub">Practise \u00b7 marked</div>' +
    "</div>" +
    '<div class="pr-bar-right">' +
    '<button class="pr-close" data-practise-act="close" aria-label="Close">' + ui("close", 16) + "</button>" +
    "</div></div>";

  html += '<div class="pr-body">';

  /* --- the score --- */
  html +=
    '<div class="pr-score">' +
    '<div class="pr-score-mark">' + r.totalMark + " / " + r.totalAvailable + "</div>" +
    '<div class="pr-score-meta">' +
    '<span class="pr-score-pct">' + pct + "%</span>" +
    '<span class="pr-score-time">' + mins + " min" + (a.autoSubmitted ? " \u00b7 time called" : "") + "</span>" +
    "</div>" +
    '<div class="pr-score-split">' +
    '<span class="pr-split-bit">Knowledge ' + r.knowledge.mark + "/" + r.knowledge.outOf + "</span>" +
    (r.exam
      ? '<span class="pr-split-bit">' + escapeHtml(r.exam.componentShort) + " " + r.exam.mark + "/" + r.exam.outOf + "</span>"
      : "") +
    "</div></div>";

  if (r.overallComment) html += '<div class="pr-verdict">' + escapeHtml(r.overallComment) + "</div>";
  if (r.exam && r.examComment) html += '<div class="pr-verdict">' + escapeHtml(r.examComment) + "</div>";

  if (r.examError) {
    html +=
      '<div class="pr-warn">' + ui("warning", 13) +
      "<span>The exam questions couldn\u2019t be marked this time, so only the knowledge stage is scored above.</span></div>";
  }
  if (!p.exam && p.examError) {
    html +=
      '<div class="pr-warn">' + ui("warning", 13) +
      "<span>Exam questions weren\u2019t set for this one: " + escapeHtml(p.examError) + "</span></div>";
  }

  /* --- flashcards --- */
  if (r.cardState === "loading") {
    html += '<div class="pr-cards-made"><div class="pr-spinner small"></div>Writing flashcards from what you missed\u2026</div>';
  } else if (r.cardState === "done") {
    html +=
      '<div class="pr-cards-made">' + ui("flashcard", 14) +
      [
        a.cardsMade ? a.cardsMade + " new flashcard" + (a.cardsMade === 1 ? "" : "s") : "",
        a.cardsResurfaced ? a.cardsResurfaced + " you already had brought back" : ""
      ]
        .filter(Boolean)
        .join(", ") +
      ", due today.</div>";
  } else if (r.cardState === "error") {
    html +=
      '<div class="pr-cards-made is-error">' + ui("warning", 14) + escapeHtml(r.cardError || "") +
      ' <button class="pr-link" data-practise-act="cards">Try again</button></div>';
  } else if (r.cardState === "none") {
    html += '<div class="pr-cards-made">' + ui("check", 14) + "Nothing missed worth making a card from.</div>";
  }

  /* --- what to do about it --- */
  if ((r.focusAreas || []).length) {
    html += '<div class="pr-section-label">Work on this next</div>';
    html += '<div class="pr-focus-list">';
    r.focusAreas.forEach((f) => {
      html +=
        '<div class="pr-focus">' +
        '<div class="pr-focus-area">' + escapeHtml(f.area) + "</div>" +
        (f.why ? '<div class="pr-focus-why">' + escapeHtml(f.why) + "</div>" : "") +
        (f.action ? '<div class="pr-focus-action">' + ui("arrowRight", 12) + escapeHtml(f.action) + "</div>" : "") +
        "</div>";
    });
    html += "</div>";
  }

  if ((r.strengths || []).length) {
    html +=
      '<div class="pr-strengths"><strong>What went well</strong><ul>' +
      r.strengths.map((s) => "<li>" + escapeHtml(s) + "</li>").join("") +
      "</ul></div>";
  }

  /* --- question by question --- */
  html += '<div class="pr-section-label">Your answers</div>';

  (r.knowledge.questions || []).forEach((q) => {
    const yours = (a.answers.knowledge || {})[String(q.number)] || "";
    const full = q.mark >= q.outOf;
    html +=
      '<div class="pr-review' + (full ? " is-right" : q.mark ? "" : " is-wrong") + '">' +
      '<div class="pr-review-head">' +
      '<span class="pr-review-badge">' + q.mark + "/" + q.outOf + "</span>" +
      '<span class="pr-review-topic">' + escapeHtml(q.topic || "Knowledge") + "</span>" +
      "</div>" +
      '<div class="pr-review-q">' + escapeHtml(q.prompt) + "</div>" +
      '<div class="pr-yours">' +
      (yours.trim() ? escapeHtml(yours) : "<em>You left this blank.</em>") +
      "</div>" +
      (q.comment ? '<div class="pr-review-why">' + escapeHtml(q.comment) + "</div>" : "") +
      ((q.missedPoints || []).length
        ? '<div class="pr-missed"><strong>Missed</strong><ul>' +
          q.missedPoints.map((m) => "<li>" + escapeHtml(m) + "</li>").join("") +
          "</ul></div>"
        : "") +
      (q.modelAnswer
        ? '<details class="pr-model"><summary>Full-mark answer</summary><div>' +
          escapeHtml(q.modelAnswer) + "</div></details>"
        : "") +
      "</div>";
  });

  if (r.exam) {
    html +=
      '<div class="pr-section-label">Exam questions \u00b7 ' + escapeHtml(r.exam.componentShort) + "</div>";
    (r.exam.questions || []).forEach((q) => {
      const yours = (a.answers.exam || {})[String(q.number)] || "";
      html +=
        '<div class="pr-review is-exam">' +
        '<div class="pr-review-head">' +
        '<span class="pr-review-badge">' + q.mark + "/" + q.outOf +
        (q.spagOutOf ? " (+" + q.spagMark + "/" + q.spagOutOf + " SPaG)" : "") + "</span>" +
        '<span class="pr-review-topic">' + escapeHtml(q.level || "") + "</span>" +
        "</div>" +
        '<div class="pr-review-q">' + escapeHtml(q.stem) + "</div>" +
        '<div class="pr-yours">' +
        (yours.trim() ? escapeHtml(yours) : "<em>You left this blank.</em>") +
        "</div>" +
        (q.examinerComment ? '<div class="pr-review-why">' + escapeHtml(q.examinerComment) + "</div>" : "") +
        (q.spagComment ? '<div class="pr-review-why">SPaG: ' + escapeHtml(q.spagComment) + "</div>" : "") +
        ((q.missedPoints || []).length
          ? '<div class="pr-missed"><strong>Missed</strong><ul>' +
            q.missedPoints.map((m) => "<li>" + escapeHtml(m) + "</li>").join("") +
            "</ul></div>"
          : "") +
        "</div>";
    });
  }

  if ((r.notesGaps || []).length) {
    html +=
      '<div class="pr-gaps"><strong>Your notes don\u2019t seem to cover</strong><ul>' +
      r.notesGaps.map((g) => "<li>" + escapeHtml(g) + "</li>").join("") +
      "</ul></div>";
  }

  html += "</div>";

  html +=
    '<div class="pr-foot">' +
    '<button class="btn-ghost" data-practise-act="retry">Another practise</button>' +
    '<button class="btn-primary" data-practise-act="close">Done</button>' +
    "</div>";

  html += "</div>";
  return html;
}
