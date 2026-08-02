// Sidebar interactions: tree navigation, expand/collapse, new pages, calendar,
// revise sessions, and JSON backup export/import.
import {
  navigateTo,
  createChildPage,
  createSubjectPage,
  toggleExpanded,
  openCalendarView,
  openTodayView
} from "../pages.js";
import { startRevise } from "../render/revise.js";
import { downloadBackup, readBackupFile, applyRestore, summarise } from "../backup.js";
import { showConfirmModal } from "../overlays.js";
import { renderSidebar } from "../render/sidebar.js";
import { renderMain } from "../render/main.js";

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
  document.getElementById("today-nav-btn").addEventListener("click", () => openTodayView());
  document.getElementById("calendar-nav-btn").addEventListener("click", () => openCalendarView());
  document.getElementById("revise-nav-btn").addEventListener("click", () => startRevise({ type: "all" }));

  document.getElementById("btn-export").addEventListener("click", () => downloadBackup());

  const importInput = document.getElementById("import-input");
  document.getElementById("btn-import").addEventListener("click", () => {
    importInput.value = "";
    importInput.click();
  });
  importInput.addEventListener("change", () => {
    const file = importInput.files && importInput.files[0];
    if (!file) return;
    readBackupFile(file)
      .then((nextState) => {
        showConfirmModal({
          title: "Restore this backup?",
          message:
            "This replaces everything currently in ReviseIQ with the backup (" +
            summarise(nextState) +
            "). This can\u2019t be undone \u2014 export your current notes first if you need them.",
          confirmLabel: "Restore",
          onConfirm: () => {
            applyRestore(nextState);
            renderSidebar();
            renderMain();
          }
        });
      })
      .catch((err) => {
        showConfirmModal({
          title: "Couldn\u2019t import that file",
          message: err.message,
          confirmLabel: "OK"
        });
      });
  });
}
