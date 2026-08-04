// Main panel rendering: breadcrumbs, header, exam panel, blocks.
// Subpages are not listed separately — they appear inline as page blocks.
import { store, getPage } from "../state.js";
import { escapeHtml, formatDateHuman, countdownInfo } from "../utils.js";
import { renderBlocksList } from "./blocks.js";
import { renderCalendarView } from "./calendar.js";
import { renderPlanView } from "./plan.js";
import { renderFlashcardsView } from "./flashcards.js";
import { renderToc } from "./toc.js";
import { iconImg, ui } from "../icons.js";
import { cardsForPage, isDue } from "../srs.js";
import { testEligibility } from "../exam/session.js";
import { quizEligibility } from "../quiz/session.js";
import { practiseEligibility } from "../practise/session.js";
import { renderWorkSection } from "./work.js";
import { renderFeedbackSection } from "./insights.js";

export function renderMain() {
  const root = document.getElementById("main-inner");

  if (store.currentView === "plan") {
    root.innerHTML = renderPlanView();
    document.getElementById("main").scrollTop = 0;
    renderToc();
    return;
  }

  // Flashcards runs inside the main column on a desktop, so the sidebar and
  // the rest of the workspace stay exactly where they were.
  if (store.currentView === "flashcards") {
    root.innerHTML = renderFlashcardsView();
    renderToc();
    return;
  }

  if (store.currentView === "calendar") {
    root.innerHTML = renderCalendarView();
    document.getElementById("main").scrollTop = 0;
    renderToc();
    return;
  }

  const page = getPage(store.state.activePageId);
  if (!page) {
    root.innerHTML = renderEmptyState();
    renderToc();
    return;
  }

  let html = renderBreadcrumbs(page);
  html += renderPageHeader(page);
  if (page.type === "subject") html += renderExamPanel(page);
  html += renderPageActions(page);
  html += '<div class="block-list" id="block-list" data-page-id="' + page.id + '">' + renderBlocksList(page.blocks) + "</div>";
  // Invisible click target: clicking the space under the last block starts a
  // new paragraph, without adding another visible "add a block" row.
  html += '<div class="page-tail" id="page-tail"></div>';
  // Everything already sat on this page, plus any feedback still outstanding.
  html += renderWorkSection(page.id, { title: "Marked work on this page" });
  html += renderFeedbackSection({ pageId: page.id, title: "Exam feedback for this page", limit: 8 });
  root.innerHTML = html;
  root.scrollTop = 0;
  document.getElementById("main").scrollTop = 0;
  renderToc();
}

/*
 * Re-renders only the block list. Typing-speed edits (Enter, Backspace, adding
 * or moving a block) use this instead of renderMain so the header, exam panel
 * and quiz history are not rebuilt - and, importantly, so the page does not
 * jump back to the top on every keystroke.
 */
export function renderBlocksOnly() {
  const page = getPage(store.state.activePageId);
  const list = document.getElementById("block-list");
  if (!page || store.currentView !== "page" || !list || list.dataset.pageId !== page.id) {
    renderMain();
    return;
  }
  list.innerHTML = renderBlocksList(page.blocks);
  renderToc();
}

export function renderEmptyState() {
  return (
    '<div class="empty-state">' +
    '<div class="big-icon">' +
    iconImg("notebook", 56) +
    "</div>" +
    "<h2>Welcome to ReviseIQ</h2>" +
    "<p>Create your first subject to start building revision notes, tracking exam dates, and organising topics.</p>" +
    '<button id="empty-new-subject">' + ui("plus", 14, 2.4) + " New subject</button>" +
    "</div>"
  );
}

/*
 * Actions above the notes: revise the flashcards in this section, and - for
 * AQA History pages only - sit a timed mock exam written from these notes.
 */
export function renderPageActions(page) {
  const revise = renderReviseButton(page);
  const quiz = renderQuizButton(page);
  const practise = renderPractiseButton(page);
  const test = renderTestButton(page);
  if (!revise && !quiz && !practise && !test) return "";
  return '<div class="page-actions">' + revise + quiz + practise + test + "</div>";
}

/*
 * Quiz me works on any page with enough written on it: a hard multiple-choice
 * quiz on these notes, marked the moment it is finished.
 */
function renderQuizButton(page) {
  const el = quizEligibility(page.id);
  if (!el) return "";
  if (!el.enough) {
    return (
      '<button class="btn-quiz is-disabled" disabled title="Add more notes first \u2014 ' +
      el.words +
      ' words so far">' +
      ui("quiz", 15) +
      "<span>Quiz me</span></button>"
    );
  }
  return (
    '<button class="btn-quiz" id="quiz-me-btn" data-page-id="' +
    page.id +
    '" title="Answer a hard multiple-choice quiz written from these notes">' +
    ui("quiz", 15) +
    "<span>Quiz me</span>" +
    '<span class="quiz-badge">MCQ</span>' +
    "</button>"
  );
}

/*
 * Practise sits between the two: ten to twenty-five minutes of written work.
 * It runs on any page with enough notes. Where the real structure of the exam
 * is known it finishes with genuine exam questions; where it is not, the
 * knowledge stage simply runs longer and no exam questions are invented.
 */
function renderPractiseButton(page) {
  const el = practiseEligibility(page.id);
  if (!el) return "";
  if (!el.enough) {
    return (
      '<button class="btn-practise is-disabled" disabled title="Add more notes first \u2014 ' +
      el.words +
      ' words so far">' +
      ui("marksheet", 15) +
      "<span>Practise</span></button>"
    );
  }
  return (
    '<button class="btn-practise" id="practise-me-btn" data-page-id="' +
    page.id +
    '" title="' +
    (el.exam
      ? "Written questions, then real exam questions \u2014 up to 25 minutes"
      : "Hard written questions on these notes \u2014 up to 25 minutes") +
    '">' +
    ui("marksheet", 15) +
    "<span>Practise</span>" +
    '<span class="practise-badge">' +
    (el.exam ? "Written + exam" : "Written") +
    "</span>" +
    "</button>"
  );
}

/*
 * The Test me button appears only where the prompt actually exists: a page
 * whose subject is History with AQA as the exam board. Everywhere else there
 * is no button at all, rather than a button that produces a bad paper.
 */
function renderTestButton(page) {
  const el = testEligibility(page.id);
  if (!el) return "";
  if (!el.enough) {
    return (
      '<button class="btn-test is-disabled" disabled title="Add more notes first \u2014 ' +
      el.words +
      ' words so far">' +
      ui("target", 15) +
      "<span>Test me</span></button>"
    );
  }
  return (
    '<button class="btn-test" id="test-me-btn" data-page-id="' +
    page.id +
    '" title="Sit a timed AQA-style mock written from these notes">' +
    ui("target", 15) +
    "<span>Test me</span>" +
    '<span class="test-badge">AQA</span>' +
    "</button>"
  );
}

function renderReviseButton(page) {
  const cards = cardsForPage(page.id);
  if (!cards.length) return "";
  const due = cards.filter((c) => isDue(c.id)).length;
  const quiet = due === 0;
  return (
    '<button class="btn-revise' +
    (quiet ? " is-quiet" : "") +
    '" id="revise-page-btn" data-page-id="' +
    page.id +
    '" title="Test yourself on the flashcards in this section">' +
    ui("flashcard", 15) +
    (quiet ? "<span>Revise" : "<span>Revise now") +
    "</span>" +
    '<span class="revise-badge">' +
    (due > 0 ? due + " due" : cards.length + " card" + (cards.length === 1 ? "" : "s")) +
    "</span>" +
    "</button>"
  );
}

export function renderBreadcrumbs(page) {
  const chain = [];
  let cur = page;
  while (cur && cur.parentId) {
    cur = getPage(cur.parentId);
    if (cur) chain.unshift(cur);
  }
  let html = '<div class="breadcrumbs">';
  chain.forEach((p) => {
    html +=
      '<span class="crumb" data-nav="' +
      p.id +
      '">' +
      iconImg(p.icon, 14) +
      '<span class="crumb-text">' +
      escapeHtml(p.title || "Untitled") +
      '</span></span><span class="crumb-sep">/</span>';
  });
  html +=
    '<span class="crumb current">' +
    iconImg(page.icon, 14) +
    '<span class="crumb-text">' +
    escapeHtml(page.title || "Untitled") +
    "</span></span></div>";
  return html;
}

export function renderPageHeader(page) {
  return (
    '<div class="page-header">' +
    '<button class="page-icon-btn" id="page-icon-btn" title="Change icon" data-page-id="' +
    page.id +
    '">' +
    iconImg(page.icon, 46) +
    "</button>" +
    '<div class="page-title" id="page-title" contenteditable="true" data-placeholder="Untitled" data-page-id="' +
    page.id +
    '">' +
    escapeHtml(page.title) +
    "</div>" +
    '<button class="page-menu-btn" data-page-menu="' +
    page.id +
    '" title="Page options">' +
    ui("dots", 18) +
    "</button></div>"
  );
}

export function renderExamPanel(page) {
  const boards = ["AQA", "Edexcel", "OCR", "WJEC / Eduqas", "CCEA", "Other"];
  let html = '<div class="meta-panel">';
  html += '<div class="meta-row"><div class="meta-label">Exam board</div><select class="board-select" id="board-select">';
  html += '<option value="" ' + (!page.examBoard ? "selected" : "") + ">Not set</option>";
  boards.forEach((b) => {
    html += '<option value="' + escapeHtml(b) + '" ' + (page.examBoard === b ? "selected" : "") + ">" + b + "</option>";
  });
  html += "</select>";
  if (page.examBoard === "Other") {
    html +=
      '<input type="text" class="board-other" id="board-other" placeholder="Enter exam board" value="' +
      escapeHtml(page.examBoardOther || "") +
      '" />';
  }
  html += "</div>";

  html +=
    '<div class="meta-row" style="align-items:flex-start;"><div class="meta-label" style="padding-top:5px;">Exam dates</div><div style="flex:1;"><div class="exam-chips" id="exam-chips">';
  const sorted = page.examDates.slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  sorted.forEach((ex) => {
    const ci = countdownInfo(ex.date);
    html +=
      '<div class="exam-chip"><span class="name">' +
      escapeHtml(ex.name) +
      '</span><span class="date">' +
      formatDateHuman(ex.date) +
      '</span><span class="badge ' +
      ci.cls +
      '">' +
      ci.label +
      '</span><button class="chip-remove" data-remove-exam="' +
      ex.id +
      '" title="Remove">' +
      ui("close", 11, 2.6) +
      "</button></div>";
  });
  html += '<button class="add-exam-btn" id="add-exam-btn">' + ui("plus", 12, 2.4) + " Add exam date</button>";
  html += "</div></div></div></div>";
  return html;
}
