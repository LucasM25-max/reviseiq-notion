/*
 * "Quiz me" - a hard multiple-choice quiz written by Gemini from your own
 * notes, on any page.
 *
 * Flow: setup card -> Gemini writes the questions -> full-screen quiz, one
 * question at a time, no timer -> instant local marking -> results, an
 * optional AI summary of your weak spots, and a one-click button that turns
 * everything you got wrong into flashcards on the page.
 */
import { getPage, getChildren } from "../state.js";
import { escapeHtml, uid } from "../utils.js";
import { scheduleSave } from "../storage.js";
import { ui } from "../icons.js";
import { collectNotes, subjectAncestor } from "../exam/notes.js";
import {
  MIN_QUIZ_WORDS,
  COUNT_CHOICES,
  OPTION_LETTERS,
  autoQuestionCount
} from "./quizPrompt.js";
import {
  saveQuizAttempt,
  getQuizAttempt,
  unfinishedQuizForPage,
  recordQuizInsights
} from "./store.js";
import { authHeaders } from "../cloud/auth.js";
import { generateFlashcardsFromMisses } from "./flashcards.js";

let session = null; // { attempt, view, error, tickId }
let onClose = () => {};

export function setQuizCloseHandler(fn) {
  onClose = fn;
}

/* ------------------------------------------------------------------ *
 * Eligibility - every page, as long as there is something to quiz on
 * ------------------------------------------------------------------ */

export function quizEligibility(pageId) {
  const page = getPage(pageId);
  if (!page) return null;
  const hasChildren = getChildren(pageId).length > 0;
  // Default scope is just this page; subpages are opt-in.
  const notes = collectNotes(pageId, false);
  const treeWords = hasChildren ? collectNotes(pageId, true).wordCount : notes.wordCount;
  return {
    pageId,
    page,
    hasChildren,
    words: notes.wordCount,
    treeWords,
    enough: notes.wordCount >= MIN_QUIZ_WORDS || treeWords >= MIN_QUIZ_WORDS
  };
}

/* ------------------------------------------------------------------ *
 * Setup card
 * ------------------------------------------------------------------ */

export function openQuizSetup(pageId) {
  const el = quizEligibility(pageId);
  if (!el) return;

  const existing = unfinishedQuizForPage(pageId);
  const modal = document.createElement("div");
  modal.className = "modal-overlay quiz-setup-overlay";
  modal.id = "quiz-setup";
  modal.innerHTML = renderSetup(el, existing);
  document.getElementById("overlay-root").appendChild(modal);

  modal.addEventListener("mousedown", (e) => {
    if (e.target === modal) modal.remove();
  });

  modal.addEventListener("click", (e) => {
    const lenBtn = e.target.closest("[data-quiz-count]");
    if (lenBtn) {
      modal.querySelectorAll("[data-quiz-count]").forEach((b) => b.classList.remove("is-on"));
      lenBtn.classList.add("is-on");
      return;
    }

    const btn = e.target.closest("[data-quiz-setup]");
    if (!btn) return;
    const act = btn.dataset.quizSetup;

    if (act === "cancel") {
      modal.remove();
      return;
    }
    if (act === "resume") {
      modal.remove();
      resumeQuiz(btn.dataset.quizId);
      return;
    }
    if (act === "discard") {
      const a = getQuizAttempt(btn.dataset.quizId);
      if (a) {
        a.status = "abandoned";
        saveQuizAttempt(a);
      }
      modal.remove();
      openQuizSetup(pageId);
      return;
    }
    if (act !== "start") return;

    const scopeEl = modal.querySelector('input[name="quiz-scope"]:checked');
    const includeSubpages = scopeEl ? scopeEl.value === "tree" : false;
    const chosen = modal.querySelector("[data-quiz-count].is-on");
    const raw = chosen ? chosen.dataset.quizCount : "auto";
    const words = includeSubpages ? el.treeWords : el.words;
    const count = raw === "auto" ? autoQuestionCount(words) : Number(raw);

    modal.remove();
    startQuiz({ pageId, includeSubpages, count });
  });
}

function renderSetup(el, existing) {
  const pageNotes = collectNotes(el.pageId, false);
  const treeNotes = el.hasChildren ? collectNotes(el.pageId, true) : pageNotes;

  let html = '<div class="modal quiz-setup">';
  html +=
    '<div class="quiz-setup-head">' +
    '<div class="quiz-setup-badge">' + ui("quiz", 15) + "Multiple choice</div>" +
    "<h3>Quiz me</h3>" +
    "<p>Gemini writes hard multiple-choice questions from these notes and marks them the moment you finish.</p>" +
    "</div>";

  if (existing) {
    html +=
      '<div class="quiz-resume">' +
      "<div><strong>You have an unfinished quiz.</strong><span>" +
      escapeHtml(existing.title || "") +
      "</span></div>" +
      '<div class="quiz-resume-actions">' +
      '<button class="btn-ghost" data-quiz-setup="discard" data-quiz-id="' + existing.id + '">Discard</button>' +
      '<button class="btn-primary" data-quiz-setup="resume" data-quiz-id="' + existing.id + '">Resume</button>' +
      "</div></div>";
  }

  html += '<label class="quiz-field-label">What should it cover?</label>';
  html += '<div class="quiz-scope">';
  html += scopeRow("page", "Just this page", pageNotes, true, true);
  html += scopeRow("tree", "This page and its subpages", treeNotes, el.hasChildren, false);
  html += "</div>";

  html += '<label class="quiz-field-label">How many questions?</label>';
  html += '<div class="quiz-count">';
  html += '<button class="quiz-count-btn is-on" data-quiz-count="auto">Auto</button>';
  COUNT_CHOICES.forEach((n) => {
    html += '<button class="quiz-count-btn" data-quiz-count="' + n + '">' + n + "</button>";
  });
  html += "</div>";
  html +=
    '<div class="quiz-field-note">Auto picks the length from how much you have written \u2014 ' +
    autoQuestionCount(el.hasChildren ? el.treeWords : el.words) +
    " questions for these notes.</div>";

  html +=
    '<div class="quiz-difficulty">' + ui("warning", 13) +
    "<span><strong>These are meant to be hard.</strong> Every wrong option is built from something nearly right in your notes, so skim-reading will not get you through.</span></div>";

  if (!el.enough) {
    html +=
      '<div class="quiz-warn">There are only ' + el.words +
      " words on this page. Add more notes first, or include your subpages.</div>";
  }

  html +=
    '<div class="modal-actions">' +
    '<button class="btn-cancel" data-quiz-setup="cancel">Cancel</button>' +
    '<button class="btn-primary" data-quiz-setup="start">Start quiz</button>' +
    "</div></div>";
  return html;
}

function scopeRow(value, label, notes, enabled, checked) {
  const pages = notes.pages.length;
  return (
    '<label class="quiz-scope-row' + (enabled ? "" : " is-off") + '">' +
    '<input type="radio" name="quiz-scope" value="' + value + '"' +
    (checked ? " checked" : "") + (enabled ? "" : " disabled") + " />" +
    "<span><strong>" + escapeHtml(label) + "</strong>" +
    '<span class="quiz-scope-meta">' + notes.wordCount + " words" +
    (pages > 1 ? " \u00b7 " + pages + " pages" : "") + "</span></span></label>"
  );
}

/* ------------------------------------------------------------------ *
 * Overlay plumbing
 * ------------------------------------------------------------------ */

function overlayEl() {
  return document.getElementById("quiz-overlay");
}

function mountOverlay(fullscreen) {
  let overlay = overlayEl();
  if (overlay) return overlay;
  overlay = document.createElement("div");
  overlay.className = "quiz-overlay";
  overlay.id = "quiz-overlay";
  document.getElementById("overlay-root").appendChild(overlay);
  overlay.addEventListener("click", handleOverlayClick);
  document.addEventListener("keydown", handleKey, true);
  // Only the quiz itself takes over the screen. Marks and feedback are read
  // like any other page, so the browser stays as it was.
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
    /* fullscreen refused - the overlay still covers the app */
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

/* ------------------------------------------------------------------ *
 * Running a quiz
 * ------------------------------------------------------------------ */

export async function startQuiz(cfg) {
  const page = getPage(cfg.pageId);
  if (!page) return;
  const subject = subjectAncestor(cfg.pageId);
  const notes = collectNotes(cfg.pageId, cfg.includeSubpages);

  const attempt = {
    id: uid(),
    pageId: cfg.pageId,
    pageTitle: page.title || "Untitled",
    subjectTitle: subject ? subject.title || "" : "",
    includeSubpages: !!cfg.includeSubpages,
    requestedCount: cfg.count,
    title: page.title || "Quiz",
    status: "generating",
    startedAt: Date.now(),
    finishedAt: null,
    elapsedSeconds: 0,
    index: 0,
    answers: {},
    flags: {},
    quiz: null,
    result: null,
    cardsMade: 0
  };

  session = { attempt, view: "generating", error: null, tickId: null };
  mountOverlay(true);
  paint();

  try {
    const res = await postJson("/api/quiz/generate", {
      count: cfg.count,
      pageTitle: page.title || "Untitled",
      includedPages: notes.pages,
      notes: notes.text
    });
    if (!session || session.attempt.id !== attempt.id) return; // closed while waiting
    attempt.quiz = res.quiz;
    attempt.title = res.quiz.title || attempt.title;
    attempt.status = "in-progress";
    attempt.startedAt = Date.now();
    saveQuizAttempt(attempt);
    session.view = "quiz";
    startTick();
    paint();
  } catch (e) {
    if (!session) return;
    session.view = "error";
    session.error = e.message;
    paint();
  }
}

export function resumeQuiz(quizId) {
  const attempt = getQuizAttempt(quizId);
  if (!attempt) return;
  if (attempt.status === "marked") {
    openQuizResults(quizId);
    return;
  }
  session = { attempt, view: "quiz", error: null, tickId: null };
  attempt.resumedAt = Date.now();
  mountOverlay(true);
  startTick();
  paint();
}

export function openQuizResults(quizId) {
  const attempt = getQuizAttempt(quizId);
  if (!attempt || !attempt.result) return;
  stopTick();
  session = { attempt, view: "results", error: null, tickId: null };
  mountOverlay(false);
  paint();
}

/* There is no timer, but a quiet elapsed clock is still useful afterwards. */
function startTick() {
  stopTick();
  session.tickId = setInterval(() => {
    const el = document.getElementById("quiz-elapsed");
    if (el) el.textContent = clock(elapsed());
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

export function closeQuiz(force) {
  if (!session) return;
  const a = session.attempt;
  if (!force && a.status === "in-progress") {
    const el = document.getElementById("quiz-leave");
    if (el) {
      el.hidden = false;
      return;
    }
  }
  if (a.status === "in-progress") {
    a.elapsedSeconds = elapsed();
    a.resumedAt = null;
    saveQuizAttempt(a);
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
    if (session.view === "quiz") {
      const el = document.getElementById("quiz-leave");
      if (el) el.hidden = false;
      return;
    }
    closeQuiz(true);
    return;
  }
  if (session.view !== "quiz") return;

  const key = String(e.key || "").toLowerCase();
  const letterIndex = OPTION_LETTERS.map((l) => l.toLowerCase()).indexOf(key);
  const numberIndex = /^[1-4]$/.test(key) ? Number(key) - 1 : -1;
  const pick = letterIndex >= 0 ? letterIndex : numberIndex;

  if (pick >= 0) {
    e.preventDefault();
    choose(pick);
    return;
  }
  if (e.key === "Enter" || e.key === "ArrowRight") {
    e.preventDefault();
    step(1);
  } else if (e.key === "ArrowLeft") {
    e.preventDefault();
    step(-1);
  } else if (key === "f") {
    e.preventDefault();
    toggleFlag();
  }
}

function handleOverlayClick(e) {
  const opt = e.target.closest("[data-quiz-option]");
  if (opt && session && session.view === "quiz") {
    choose(Number(opt.dataset.quizOption));
    return;
  }

  const jump = e.target.closest("[data-quiz-jump]");
  if (jump && session) {
    session.attempt.index = Number(jump.dataset.quizJump);
    paint();
    return;
  }

  const btn = e.target.closest("[data-quiz-act]");
  if (!btn || !session) return;
  const act = btn.dataset.quizAct;

  if (act === "close") closeQuiz(false);
  else if (act === "leave-cancel") {
    const el = document.getElementById("quiz-leave");
    if (el) el.hidden = true;
  } else if (act === "leave-save") closeQuiz(true);
  else if (act === "next") step(1);
  else if (act === "prev") step(-1);
  else if (act === "flag") toggleFlag();
  else if (act === "finish-ask") {
    const el = document.getElementById("quiz-finish-confirm");
    if (el) el.hidden = false;
  } else if (act === "finish-cancel") {
    const el = document.getElementById("quiz-finish-confirm");
    if (el) el.hidden = true;
  } else if (act === "finish") finish();
  else if (act === "review") runReview();
  else if (act === "flashcards") runFlashcards();
  else if (act === "retry") {
    const a = session.attempt;
    closeQuiz(true);
    startQuiz({ pageId: a.pageId, includeSubpages: a.includeSubpages, count: a.requestedCount });
  } else if (act === "retry-wrong") retryWrong();
}

function choose(index) {
  const a = session.attempt;
  const q = a.quiz.questions[a.index];
  if (!q || index < 0 || index > 3) return;
  a.answers[q.number] = index;
  saveQuizAttempt(a);
  paint();
}

function toggleFlag() {
  const a = session.attempt;
  const q = a.quiz.questions[a.index];
  if (!q) return;
  if (a.flags[q.number]) delete a.flags[q.number];
  else a.flags[q.number] = true;
  saveQuizAttempt(a);
  paint();
}

function step(delta) {
  const a = session.attempt;
  const next = a.index + delta;
  if (next < 0) return;
  if (next >= a.quiz.questions.length) {
    const el = document.getElementById("quiz-finish-confirm");
    if (el) el.hidden = false;
    return;
  }
  a.index = next;
  paint();
}

/* ------------------------------------------------------------------ *
 * Marking - done here, because the answers came back with the paper
 * ------------------------------------------------------------------ */

function finish() {
  const a = session.attempt;
  const questions = a.quiz.questions;
  const wrong = [];
  let score = 0;

  questions.forEach((q) => {
    const chosen = a.answers[q.number];
    const right = chosen === q.correctIndex;
    if (right) {
      score += 1;
      return;
    }
    wrong.push({
      number: q.number,
      question: q.question,
      topic: q.topic || q.question,
      correct: q.options[q.correctIndex],
      chose: typeof chosen === "number" ? q.options[chosen] : "",
      explanation: q.explanation || ""
    });
  });

  a.elapsedSeconds = elapsed();
  a.resumedAt = null;
  a.finishedAt = Date.now();
  a.status = "marked";
  a.result = {
    score,
    total: questions.length,
    percentage: Math.round((score / questions.length) * 100),
    wrong,
    focusAreas: [],
    reviewState: wrong.length ? "idle" : "none",
    cardState: wrong.length ? "idle" : "none",
    cardError: null
  };
  stopTick();
  saveQuizAttempt(a);
  recordQuizInsights(a);

  session.view = "results";
  exitFullscreen(); // marks are not taken under exam conditions
  const shell = overlayEl();
  if (shell) shell.classList.add("is-review");
  paint();

  // The weak-spot summary and the flashcards are both worth having, so ask
  // for them straight away. Cards are the point of a quiz, not an extra step.
  if (wrong.length) {
    runReview();
    runFlashcards();
  }
}

async function runReview() {
  const a = session.attempt;
  if (!a.result || !a.result.wrong.length) return;
  a.result.reviewState = "loading";
  a.result.reviewError = null;
  paint();
  try {
    const res = await postJson("/api/quiz/review", {
      pageTitle: a.pageTitle,
      score: a.result.score,
      total: a.result.total,
      missed: a.result.wrong.map((w) => ({
        topic: w.topic,
        question: w.question,
        correct: w.correct,
        chose: w.chose
      }))
    });
    if (!session || session.attempt.id !== a.id) return;
    a.result.focusAreas = res.focusAreas || [];
    a.result.reviewState = "done";
    saveQuizAttempt(a);
    recordQuizInsights(a, true);
  } catch (e) {
    if (!session || session.attempt.id !== a.id) return;
    a.result.reviewState = "error";
    a.result.reviewError = e.message;
  }
  paint();
}

function retryWrong() {
  const a = session.attempt;
  if (!a.result || !a.result.wrong.length) return;
  const numbers = a.result.wrong.map((w) => w.number);
  const questions = a.quiz.questions.filter((q) => numbers.indexOf(q.number) >= 0);

  const retry = {
    id: uid(),
    pageId: a.pageId,
    pageTitle: a.pageTitle,
    subjectTitle: a.subjectTitle,
    includeSubpages: a.includeSubpages,
    requestedCount: questions.length,
    title: a.title + " \u00b7 second attempt",
    status: "in-progress",
    startedAt: Date.now(),
    finishedAt: null,
    elapsedSeconds: 0,
    index: 0,
    answers: {},
    flags: {},
    quiz: { title: a.title, questions },
    result: null,
    cardsMade: 0
  };

  session = { attempt: retry, view: "quiz", error: null, tickId: null };
  const shell = overlayEl();
  if (shell) {
    shell.classList.remove("is-review");
    requestFullscreen(overlayEl());
  }
  saveQuizAttempt(retry);
  startTick();
  paint();
}

/* ------------------------------------------------------------------ *
 * Wrong answers -> flashcards on the page
 * ------------------------------------------------------------------ */

async function runFlashcards() {
  const a = session.attempt;
  const page = getPage(a.pageId);
  if (!page || !a.result || !a.result.wrong.length) return;
  if (a.result.cardState === "loading") return;

  a.result.cardState = "loading";
  a.result.cardError = null;
  paint();

  const out = await generateFlashcardsFromMisses({
    pageId: a.pageId,
    pageTitle: a.pageTitle,
    subjectTitle: a.subjectTitle,
    source: "quiz",
    score: a.result.score,
    total: a.result.total,
    misses: a.result.wrong.map((w) => ({
      topic: w.topic,
      question: w.question,
      correct: w.correct,
      chose: w.chose,
      explanation: w.explanation
    }))
  });

  if (!session || session.attempt.id !== a.id) return;
  a.cardsMade = (a.cardsMade || 0) + out.made;
  a.result.cardsAiWritten = out.aiUsed;
  a.result.cardState = out.made ? "done" : "error";
  a.result.cardError = out.made
    ? null
    : out.error || "Couldn\u2019t write flashcards from this one.";
  saveQuizAttempt(a);
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
    throw new Error("No connection to the server. Quiz me needs to be online.");
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
      "Writing your quiz",
      "Gemini is reading your notes and setting questions designed to catch you out. This takes about fifteen seconds."
    );
  } else if (session.view === "error") {
    overlay.innerHTML = renderError(session.error);
  } else if (session.view === "results") {
    overlay.innerHTML = renderResults(session.attempt);
  } else {
    overlay.innerHTML = renderQuiz(session.attempt);
  }
}

function renderBusy(title, sub) {
  return (
    '<div class="quiz-shell quiz-centred">' +
    '<div class="quiz-busy"><div class="quiz-spinner"></div>' +
    "<h2>" + escapeHtml(title) + "</h2><p>" + escapeHtml(sub) + "</p>" +
    '<button class="btn-ghost" data-quiz-act="close">Cancel</button>' +
    "</div></div>"
  );
}

function renderError(message) {
  return (
    '<div class="quiz-shell quiz-centred">' +
    '<div class="quiz-busy">' +
    '<div class="quiz-error-icon">' + ui("warning", 30) + "</div>" +
    "<h2>Couldn\u2019t build the quiz</h2>" +
    "<p>" + escapeHtml(message || "Something went wrong.") + "</p>" +
    '<button class="btn-ghost" data-quiz-act="close">Close</button>' +
    "</div></div>"
  );
}

function renderQuiz(attempt) {
  const questions = attempt.quiz.questions;
  const q = questions[attempt.index];
  const chosen = attempt.answers[q.number];
  const answered = Object.keys(attempt.answers).length;

  let html = '<div class="quiz-shell">';

  html +=
    '<div class="quiz-bar">' +
    '<div class="quiz-bar-left">' +
    '<div class="quiz-bar-title">' + escapeHtml(attempt.title) + "</div>" +
    '<div class="quiz-bar-sub">Question ' + (attempt.index + 1) + " of " + questions.length +
    " \u00b7 " + answered + " answered</div>" +
    "</div>" +
    '<div class="quiz-elapsed" id="quiz-elapsed" title="Time on this quiz \u2014 there is no limit">' +
    ui("stopwatch", 13) + "<span>" + clock(elapsed()) + "</span></div>" +
    '<div class="quiz-bar-right">' +
    '<button class="quiz-finish-btn" data-quiz-act="finish-ask">Finish</button>' +
    '<button class="quiz-close" data-quiz-act="close" title="Leave (your answers are saved)">' +
    ui("close", 16, 2.2) + "</button>" +
    "</div></div>";

  html += '<div class="quiz-dots">';
  questions.forEach((item, i) => {
    const done = typeof attempt.answers[item.number] === "number";
    html +=
      '<button class="quiz-dot' +
      (i === attempt.index ? " is-current" : "") +
      (done ? " is-done" : "") +
      (attempt.flags[item.number] ? " is-flagged" : "") +
      '" data-quiz-jump="' + i + '" title="Question ' + (i + 1) + '">' + (i + 1) + "</button>";
  });
  html += "</div>";

  html += '<div class="quiz-body">';
  html += '<div class="quiz-card">';
  html += '<div class="quiz-q-num">Question ' + (attempt.index + 1) + "</div>";
  html += '<div class="quiz-q-text">' + escapeHtml(q.question) + "</div>";

  html += '<div class="quiz-options">';
  q.options.forEach((opt, i) => {
    html +=
      '<button class="quiz-option' + (chosen === i ? " is-chosen" : "") + '" data-quiz-option="' + i + '">' +
      '<span class="quiz-option-letter">' + OPTION_LETTERS[i] + "</span>" +
      '<span class="quiz-option-text">' + escapeHtml(opt) + "</span></button>";
  });
  html += "</div>";

  html +=
    '<div class="quiz-card-foot">' +
    '<button class="quiz-flag' + (attempt.flags[q.number] ? " is-on" : "") + '" data-quiz-act="flag">' +
    ui("flag", 14) + (attempt.flags[q.number] ? "Flagged" : "Flag for later") + "</button>" +
    '<div class="quiz-nav">' +
    '<button class="btn-ghost" data-quiz-act="prev"' + (attempt.index === 0 ? " disabled" : "") + ">Back</button>" +
    '<button class="btn-primary" data-quiz-act="next">' +
    (attempt.index === questions.length - 1 ? "Finish" : "Next") + "</button>" +
    "</div></div>";

  html += "</div>"; // card
  html += '<div class="quiz-hint">Press A\u2013D or 1\u20134 to answer, Enter for the next question, F to flag. Nothing is marked until you finish.</div>';
  html += "</div>"; // body

  const unanswered = questions.length - answered;
  html +=
    '<div class="quiz-confirm" id="quiz-finish-confirm" hidden><div class="quiz-confirm-card">' +
    "<h3>Finish the quiz?</h3><p>" +
    (unanswered
      ? escapeHtml(
          unanswered + " question" + (unanswered === 1 ? " is" : "s are") + " still unanswered and will be marked wrong."
        )
      : "Every question is answered.") +
    "</p>" +
    '<div class="modal-actions"><button class="btn-cancel" data-quiz-act="finish-cancel">Keep going</button>' +
    '<button class="btn-primary" data-quiz-act="finish">Finish and mark</button></div></div></div>';

  html +=
    '<div class="quiz-confirm" id="quiz-leave" hidden><div class="quiz-confirm-card">' +
    "<h3>Leave this quiz?</h3><p>Your answers are saved and you can pick it up again from this page.</p>" +
    '<div class="modal-actions"><button class="btn-cancel" data-quiz-act="leave-cancel">Stay</button>' +
    '<button class="btn-danger" data-quiz-act="leave-save">Leave</button></div></div></div>';

  html += "</div>";
  return html;
}

function renderResults(attempt) {
  const r = attempt.result;
  const questions = attempt.quiz.questions;

  let html = '<div class="quiz-shell quiz-results">';

  html +=
    '<div class="quiz-bar">' +
    '<div class="quiz-bar-left">' +
    '<div class="quiz-bar-title">Marked \u00b7 ' + escapeHtml(attempt.title) + "</div>" +
    '<div class="quiz-bar-sub">' + escapeHtml(attempt.pageTitle) +
    (attempt.includeSubpages ? " and subpages" : "") + "</div></div>" +
    '<div class="quiz-bar-right">' +
    '<button class="quiz-close" data-quiz-act="close" title="Close">' + ui("close", 16, 2.2) + "</button>" +
    "</div></div>";

  html += '<div class="quiz-body">';

  html +=
    '<div class="quiz-score">' +
    '<div class="quiz-score-mark"><span class="big">' + r.score + '</span><span class="outof">/ ' + r.total + "</span></div>" +
    '<div class="quiz-score-meta">' +
    '<div class="quiz-score-pct">' + ui("medal", 15) + r.percentage + "%</div>" +
    '<div class="quiz-score-time">' + clock(attempt.elapsedSeconds || 0) + " taken</div>" +
    "</div></div>";

  html += renderWeakSpots(r);

  if (r.wrong.length) {
    const state = r.cardState || "idle";
    html += '<div class="quiz-actions">';
    if (state === "loading") {
      html +=
        '<button class="btn-primary" disabled><span class="quiz-spinner small"></span>' +
        "Writing flashcards from your mistakes\u2026</button>";
    } else if (state === "done") {
      html +=
        '<button class="btn-primary" data-quiz-act="flashcards">' + ui("cards", 15) +
        "Write more flashcards</button>";
    } else {
      html +=
        '<button class="btn-primary" data-quiz-act="flashcards">' + ui("cards", 15) +
        (state === "error" ? "Try flashcards again" : "Write flashcards from my mistakes") +
        "</button>";
    }
    html +=
      '<button class="btn-ghost" data-quiz-act="retry-wrong">Retake wrong only</button>' +
      '<button class="btn-ghost" data-quiz-act="retry">New quiz on this page</button>' +
      "</div>";

    if (state === "error") {
      html +=
        '<div class="quiz-cards-made is-error">' + ui("warning", 13) + " " +
        escapeHtml(r.cardError || "Couldn\u2019t write flashcards from this one.") + "</div>";
    } else if (attempt.cardsMade) {
      html +=
        '<div class="quiz-cards-made">' + ui("check", 13) + " " + attempt.cardsMade +
        " flashcard" + (attempt.cardsMade === 1 ? "" : "s") +
        (r.cardsAiWritten ? " written by Gemini" : " built") +
        " from what you got wrong, under \u201cFlashcards from your mistakes\u201d on this page." +
        " They are in your revision schedule from today.</div>";
    }
  } else {
    html +=
      '<div class="quiz-actions">' +
      '<button class="btn-primary" data-quiz-act="retry">Another quiz on this page</button>' +
      "</div>";
  }

  html += '<div class="quiz-section-label">Question by question</div>';

  questions.forEach((q) => {
    const chosen = attempt.answers[q.number];
    const right = chosen === q.correctIndex;
    html +=
      '<div class="quiz-review' + (right ? " is-right" : " is-wrong") + '">' +
      '<div class="quiz-review-head">' +
      '<span class="quiz-review-badge">' + (right ? ui("check", 13) + " Correct" : ui("close", 13, 2.4) + " Wrong") + "</span>" +
      '<span class="quiz-review-topic">' + escapeHtml(q.topic || "") + "</span>" +
      "</div>" +
      '<div class="quiz-review-q">' + escapeHtml(q.question) + "</div>" +
      '<div class="quiz-review-options">';

    q.options.forEach((opt, i) => {
      const isCorrect = i === q.correctIndex;
      const isChosen = chosen === i;
      const note = (q.distractorNotes || [])[i] || "";
      html +=
        '<div class="quiz-review-option' +
        (isCorrect ? " is-correct" : "") +
        (isChosen && !isCorrect ? " is-yours" : "") +
        '">' +
        '<span class="quiz-option-letter">' + OPTION_LETTERS[i] + "</span>" +
        '<span class="quiz-review-option-text">' + escapeHtml(opt) +
        (isChosen ? '<span class="quiz-yours-tag">your answer</span>' : "") +
        (isChosen && !isCorrect && note ? '<span class="quiz-why">' + escapeHtml(note) + "</span>" : "") +
        "</span></div>";
    });

    html += "</div>";
    if (typeof chosen !== "number") html += '<div class="quiz-review-skip">You did not answer this one.</div>';
    if (q.explanation) html += '<div class="quiz-review-why">' + escapeHtml(q.explanation) + "</div>";
    html += "</div>";
  });

  html +=
    '<div class="quiz-foot">' +
    "<p>Everything you got wrong has been saved to <strong>Exam feedback</strong> on this page and on Today, so it doesn\u2019t vanish with this screen.</p>" +
    '<button class="btn-primary" data-quiz-act="close">Done</button>' +
    "</div>";

  html += "</div></div>";
  return html;
}

function renderWeakSpots(r) {
  if (!r.wrong.length) {
    return '<div class="quiz-weak is-clean">' + ui("check", 14) + " Full marks. Nothing to work on from this one.</div>";
  }
  if (r.reviewState === "loading") {
    return '<div class="quiz-weak is-loading"><span class="quiz-spinner small"></span> Working out where you are weak\u2026</div>';
  }
  if (r.reviewState === "error") {
    return (
      '<div class="quiz-weak is-error">' +
      ui("warning", 14) +
      " " + escapeHtml(r.reviewError || "Couldn\u2019t summarise your weak spots.") +
      ' <button class="quiz-link" data-quiz-act="review">Try again</button></div>'
    );
  }
  if (!r.focusAreas || !r.focusAreas.length) return "";

  let html = '<div class="quiz-weak">';
  html += '<div class="quiz-weak-title">' + ui("target", 14) + " Where you are weak</div>";
  html += '<div class="quiz-weak-list">';
  r.focusAreas.forEach((f) => {
    html +=
      '<div class="quiz-weak-row">' +
      '<div class="quiz-weak-area">' + escapeHtml(f.area || "") + "</div>" +
      '<div class="quiz-weak-why">' + escapeHtml(f.why || "") + "</div>" +
      (f.action ? '<div class="quiz-weak-action">' + escapeHtml(f.action) + "</div>" : "") +
      "</div>";
  });
  html += "</div></div>";
  return html;
}
