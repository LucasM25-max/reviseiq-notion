// Sidebar rendering: next-exam card and the page tree.
import { store, getPage, getChildren } from "../state.js";
import { escapeHtml, formatDateHuman, countdownInfo } from "../utils.js";
import { computeNextExam } from "../exams.js";

export function renderSidebar() {
  renderNextExamBanner();
  const calBtn = document.getElementById("calendar-nav-btn");
  if (calBtn) calBtn.classList.toggle("active", store.currentView === "calendar");
  const tree = document.getElementById("sidebar-tree");
  let html = "";
  store.state.rootPageIds.forEach((id) => {
    if (store.state.pages[id]) html += renderSidebarNode(id, 0);
  });
  tree.innerHTML = html;
}

export function renderNextExamBanner() {
  const slot = document.getElementById("next-exam-slot");
  const best = computeNextExam();
  if (!best) {
    slot.innerHTML = "";
    return;
  }
  const ci = countdownInfo(best.date);
  slot.innerHTML =
    '<div class="next-exam" data-nav="' +
    best.subjectId +
    '"><div class="label">Next exam</div>' +
    '<div class="title">' +
    escapeHtml(best.name) +
    "</div>" +
    '<div class="sub">' +
    escapeHtml(best.subject) +
    " \u00B7 " +
    formatDateHuman(best.date) +
    ' \u00B7 <span style="color:var(--accent);font-weight:600;">' +
    ci.label +
    "</span></div></div>";
}

function renderSidebarNode(pageId, depth) {
  const p = getPage(pageId);
  if (!p) return "";
  const kids = getChildren(pageId);
  const hasKids = kids.length > 0;
  const isExpanded = !!store.state.expanded[pageId];
  const isActive = store.state.activePageId === pageId && store.currentView === "page";

  let html =
    '<div class="tree-node">' +
    '<div class="tree-row' +
    (isActive ? " active" : "") +
    '" data-page-id="' +
    pageId +
    '" style="padding-left:' +
    (6 + depth * 16) +
    'px;">' +
    '<div class="tree-chevron' +
    (hasKids ? "" : " spacer") +
    (hasKids && !isExpanded ? " collapsed" : "") +
    '" data-chevron="' +
    pageId +
    '">' +
    (hasKids
      ? '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="6 9 12 15 18 9"/></svg>'
      : "") +
    "</div>" +
    '<div class="tree-icon">' +
    p.icon +
    "</div>" +
    '<div class="tree-title">' +
    escapeHtml(p.title || "Untitled") +
    "</div>" +
    '<button class="tree-add" data-add-child="' +
    pageId +
    '" title="Add subpage"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>' +
    "</div>" +
    '<div class="tree-children">';

  if (hasKids && isExpanded) {
    kids.forEach((k) => {
      html += renderSidebarNode(k.id, depth + 1);
    });
  }
  html += "</div></div>";
  return html;
}
