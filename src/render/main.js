// Main panel rendering: breadcrumbs, header, exam panel, blocks.
// Subpages are not listed separately — they appear inline as page blocks.
import { store, getPage } from "../state.js";
import { escapeHtml, formatDateHuman, countdownInfo } from "../utils.js";
import { renderBlocksList } from "./blocks.js";
import { renderCalendarView } from "./calendar.js";
import { renderTodayView } from "./today.js";
import { renderToc } from "./toc.js";
import { iconImg, ui } from "../icons.js";
import { cardsForPage, isDue } from "../srs.js";

export function renderMain() {
  const root = document.getElementById("main-inner");

  if (store.currentView === "today") {
    root.innerHTML = renderTodayView();
    document.getElementById("main").scrollTop = 0;
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
  root.innerHTML = html;
  root.scrollTop = 0;
  document.getElementById("main").scrollTop = 0;
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

/* Revise entry point for the current page and everything nested under it. */
export function renderPageActions(page) {
  const cards = cardsForPage(page.id);
  if (!cards.length) return "";
  const due = cards.filter((c) => isDue(c.id)).length;
  const quiet = due === 0;
  return (
    '<div class="page-actions">' +
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
    "</button>" +
    "</div>"
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
    "</div></div>"
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
