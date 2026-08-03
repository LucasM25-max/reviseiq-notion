// App entry point: load saved data, wire events, paint the first screen.
import { store, getPage } from "./state.js";
import { loadState } from "./storage.js";
import { renderSidebar } from "./render/sidebar.js";
import { renderMain } from "./render/main.js";
import { initGlobalDismiss, setRerenderMain } from "./overlays.js";
import { initMainEvents } from "./events/mainEvents.js";
import { initSidebarEvents } from "./events/sidebarEvents.js";
import { setReviseCloseHandler, startRevise } from "./render/revise.js";
import { setTestCloseHandler } from "./exam/session.js";
import { navigateTo, openTodayView } from "./pages.js";
import { initMobileEvents } from "./events/mobileEvents.js";
import { registerServiceWorker, initConnectivityNotices } from "./pwa.js";

function boot() {
  setRerenderMain(renderMain);
  setReviseCloseHandler((pageId) => {
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
  initGlobalDismiss();
  initMainEvents();
  initSidebarEvents();
  initMobileEvents();
  initConnectivityNotices();
  registerServiceWorker();

  loadState();

  if (!store.state.activePageId || !getPage(store.state.activePageId)) {
    store.state.activePageId = store.state.rootPageIds[0] || null;
    // Land on the Today dashboard rather than a blank page.
    store.currentView = "today";
  }

  renderSidebar();
  renderMain();
  applyLaunchShortcut();
}

/* Home-screen shortcuts land on /?view=today or /?view=revise. */
function applyLaunchShortcut() {
  const view = new URLSearchParams(location.search).get("view");
  if (!view) return;
  history.replaceState(null, "", location.pathname);
  if (view === "today") openTodayView();
  else if (view === "revise") startRevise({ type: "all" });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
