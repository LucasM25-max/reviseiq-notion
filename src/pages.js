// Page-level operations: create, delete, rename, navigate.
import { store, getPage, getAllDescendantIds, getAncestors, findPageBlockRef } from "./state.js";
import { newPageObject } from "./model.js";
import { uid } from "./utils.js";
import { scheduleSave } from "./storage.js";
import { renderSidebar } from "./render/sidebar.js";
import { renderMain } from "./render/main.js";
import { closeAllFloating } from "./overlays.js";

export function createSubjectPage(title) {
  const p = newPageObject({ type: "subject", title: title || "", parentId: null });
  store.state.pages[p.id] = p;
  store.state.rootPageIds.push(p.id);
  store.state.expanded[p.id] = true;
  navigateTo(p.id);
  scheduleSave();
  return p;
}

export function createChildPage(parentId, title) {
  const parent = getPage(parentId);
  if (!parent) return null;
  const p = newPageObject({ type: "page", title: title || "", parentId });
  store.state.pages[p.id] = p;
  store.state.expanded[p.id] = true;
  store.state.expanded[parentId] = true;
  parent.blocks.push({ id: uid(), type: "page", childPageId: p.id });
  navigateTo(p.id);
  scheduleSave();
  return p;
}

export function deletePage(pageId) {
  const page = getPage(pageId);
  if (!page) return;
  const descendants = getAllDescendantIds(pageId);
  const toDelete = descendants.concat([pageId]);

  if (page.parentId) {
    const parent = getPage(page.parentId);
    if (parent) {
      const ref = findPageBlockRef(parent, pageId);
      if (ref) ref.arr.splice(ref.idx, 1);
    }
  } else {
    const ri = store.state.rootPageIds.indexOf(pageId);
    if (ri > -1) store.state.rootPageIds.splice(ri, 1);
  }

  for (let i = 0; i < toDelete.length; i++) {
    delete store.state.pages[toDelete[i]];
    delete store.state.expanded[toDelete[i]];
  }

  if (toDelete.indexOf(store.state.activePageId) > -1) {
    store.state.activePageId =
      page.parentId && store.state.pages[page.parentId] ? page.parentId : store.state.rootPageIds[0] || null;
  }
  scheduleSave();
}

export function renamePage(pageId, title) {
  const p = getPage(pageId);
  if (!p) return;
  p.title = title;
  scheduleSave();
}

export function setPageIcon(pageId, icon) {
  const p = getPage(pageId);
  if (!p) return;
  p.icon = icon;
  scheduleSave();
  renderSidebar();
  renderMain();
}

export function setExamBoard(pageId, board) {
  const p = getPage(pageId);
  if (!p || p.type !== "subject") return;
  p.examBoard = board;
  scheduleSave();
}

export function setExamBoardOther(pageId, val) {
  const p = getPage(pageId);
  if (!p || p.type !== "subject") return;
  p.examBoardOther = val;
  scheduleSave();
}

export function addExamDate(pageId, name, date) {
  const p = getPage(pageId);
  if (!p || p.type !== "subject") return;
  p.examDates.push({ id: uid(), name, date });
  scheduleSave();
}

export function removeExamDate(pageId, examId) {
  const p = getPage(pageId);
  if (!p || p.type !== "subject") return;
  p.examDates = p.examDates.filter((e) => e.id !== examId);
  scheduleSave();
}

export function navigateTo(pageId) {
  store.currentView = "page";
  store.state.activePageId = pageId;
  closeAllFloating();
  const chain = getAncestors(pageId);
  for (let i = 0; i < chain.length; i++) store.state.expanded[chain[i].id] = true;
  renderSidebar();
  renderMain();
}

export function openCalendarView() {
  store.currentView = "calendar";
  closeAllFloating();
  renderSidebar();
  renderMain();
}

export function toggleExpanded(pageId) {
  store.state.expanded[pageId] = !store.state.expanded[pageId];
  renderSidebar();
  scheduleSave();
}
