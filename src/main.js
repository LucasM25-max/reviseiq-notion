// App entry point: load saved data, wire events, paint the first screen.
import { store, getPage } from "./state.js";
import { loadState } from "./storage.js";
import { renderSidebar } from "./render/sidebar.js";
import { renderMain } from "./render/main.js";
import { initGlobalDismiss, setRerenderMain } from "./overlays.js";
import { initMainEvents } from "./events/mainEvents.js";
import { initSidebarEvents } from "./events/sidebarEvents.js";
import { setReviseCloseHandler } from "./render/revise.js";
import { navigateTo } from "./pages.js";

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
  initGlobalDismiss();
  initMainEvents();
  initSidebarEvents();

  loadState();

  if (!store.state.activePageId || !getPage(store.state.activePageId)) {
    store.state.activePageId = store.state.rootPageIds[0] || null;
  }

  renderSidebar();
  renderMain();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
