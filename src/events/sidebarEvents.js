// Sidebar interactions: tree navigation, expand/collapse, new pages, calendar.
import { navigateTo, createChildPage, createSubjectPage, toggleExpanded, openCalendarView } from "../pages.js";

export function initSidebarEvents() {
  const sidebarTree = document.getElementById("sidebar-tree");

  sidebarTree.addEventListener("click", (e) => {
    const chev = e.target.closest("[data-chevron]");
    if (chev) {
      e.stopPropagation();
      toggleExpanded(chev.dataset.chevron);
      return;
    }
    const addChild = e.target.closest("[data-add-child]");
    if (addChild) {
      e.stopPropagation();
      createChildPage(addChild.dataset.addChild, "");
      return;
    }
    const row = e.target.closest(".tree-row");
    if (row) navigateTo(row.dataset.pageId);
  });

  document.getElementById("next-exam-slot").addEventListener("click", (e) => {
    const card = e.target.closest("[data-nav]");
    if (card) navigateTo(card.dataset.nav);
  });

  document.getElementById("btn-new-subject").addEventListener("click", () => createSubjectPage(""));
  document.getElementById("calendar-nav-btn").addEventListener("click", () => openCalendarView());
}
