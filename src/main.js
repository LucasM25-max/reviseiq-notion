// App entry point: load saved data, wire events, paint the first screen.
import { store, getPage } from "./state.js";
import { loadState, initAutosave } from "./storage.js";
import { renderSidebar } from "./render/sidebar.js";
import { renderMain, renderBlocksOnly } from "./render/main.js";
import { initGlobalDismiss, setRerenderMain } from "./overlays.js";
import { initMainEvents } from "./events/mainEvents.js";
import { initSidebarEvents } from "./events/sidebarEvents.js";
import { setFlashcardsCloseHandler, setFlashcardsRerender, startFlashcards } from "./render/flashcards.js";
import { setTestCloseHandler } from "./exam/session.js";
import { setQuizCloseHandler } from "./quiz/session.js";
import { navigateTo, openPlanView } from "./pages.js";
import { initMobileEvents } from "./events/mobileEvents.js";
import { registerServiceWorker, initConnectivityNotices } from "./pwa.js";
import { initCloud } from "./cloud/index.js";

function boot() {
  // Formatting must come out as <b>/<i>/<u> tags, not styled spans, so it
  // survives being sanitised and re-rendered (notably inside tables).
  try {
    document.execCommand("styleWithCSS", false, false);
  } catch (e) {
    /* not supported: formatting still works, just less tidily */
  }
  // The slash menu (convert block type) and block context menu
  // (move/duplicate/delete) share this hook. Using the lightweight
  // block-list renderer here keeps the user's scroll position instead of
  // jumping back to the top of the page every time a block is added,
  // converted, moved, duplicated, or deleted.
  setRerenderMain(renderBlocksOnly);
  setFlashcardsRerender(() => renderMain());
  setFlashcardsCloseHandler((pageId) => {
    if (pageId && getPage(pageId)) {
      navigateTo(pageId);
      return;
    }
    renderSidebar();
    renderMain();
  });
  setTestCloseHandler(() => {
    renderSidebar();
    renderMain();
  });
  setQuizCloseHandler(() => {
    renderSidebar();
    renderMain();
  });
  initGlobalDismiss();
  initMainEvents();
  initSidebarEvents();
  initMobileEvents();
  initConnectivityNotices();
  registerServiceWorker();

  loadState();

  if (!store.state.activePageId || !getPage(store.state.activePageId)) {
    store.state.activePageId = store.state.rootPageIds[0] || null;
    // Land on the plan rather than a blank page.
    store.currentView = "plan";
  }

  renderSidebar();
  renderMain();
  applyLaunchShortcut();

  // localStorage first, always. Cloud sync is layered on top and is a
  // no-op when the deployment has no Firebase configured.
  initAutosave();
  initCloud({
    rerender: () => {
      renderSidebar();
      renderMain();
    }
  });
}

/* Home-screen shortcuts land on /?view=plan or /?view=flashcards. */
function applyLaunchShortcut() {
  const view = new URLSearchParams(location.search).get("view");
  if (!view) return;
  history.replaceState(null, "", location.pathname);
  if (view === "plan" || view === "today") openPlanView();
  else if (view === "flashcards" || view === "revise") startFlashcards({ type: "all" });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
