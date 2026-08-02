// Main panel rendering: breadcrumbs, header, exam panel, subpages, blocks.
import { store, getPage, getChildren, getAncestors, findPageBlockRef } from "../state.js";
import { escapeHtml, formatDateHuman, countdownInfo } from "../utils.js";
import { renderBlocksList } from "./blocks.js";
import { renderCalendarView } from "./calendar.js";
import { renderToc } from "./toc.js";
import { iconImg, ui } from "../icons.js";

export function renderMain() {
  const root = document.getElementById("main-inner");

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
  html += renderSubpagesList(page);
  html += '<div class="block-list" id="block-list" data-page-id="' + page.id + '">' + renderBlocksList(page.blocks) + "</div>";
  html +=
    '<div class="add-block-row"><div class="add-block-ghost" id="add-block-ghost">' +
    ui("plus", 14, 2.2) +
    " Click to add a block, or type / for commands</div></div>";
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

export function renderBreadcrumbs(page) {
  const chain = getAncestors(page.id);
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

/*
 * Subpages that already appear inline as a page block in the body are skipped
 * here, so a nested page is only ever listed once.
 */
export function renderSubpagesList(page) {
  const kids = getChildren(page.id).filter((k) => !findPageBlockRef(page, k.id));
  if (kids.length === 0) return "";
  let html = '<div class="subpages-list">';
  kids.forEach((k) => {
    const n = getChildren(k.id).length;
    html +=
      '<div class="subpage-row" data-nav="' +
      k.id +
      '"><span class="icon">' +
      iconImg(k.icon, 18) +
      '</span><span class="title">' +
      escapeHtml(k.title || "Untitled") +
      "</span>" +
      (n > 0 ? '<span class="sub">' + n + " subpage" + (n > 1 ? "s" : "") + "</span>" : "") +
      '<button class="del" data-del-page="' +
      k.id +
      '" title="Delete page">' +
      ui("trash", 14) +
      "</button></div>";
  });
  html += "</div>";
  return html;
}
