// Drawer behaviour for the mobile layout. On desktop none of this fires
// because the top bar and scrim are display:none and the sidebar is static.
import { openTodayView } from "../pages.js";
import { startRevise } from "../render/revise.js";

const MOBILE_MAX = 860;

export function isMobile() {
  return window.matchMedia("(max-width: " + MOBILE_MAX + "px)").matches;
}

export function openDrawer() {
  document.getElementById("sidebar").classList.add("open");
  document.getElementById("sidebar-scrim").classList.add("show");
}

export function closeDrawer() {
  document.getElementById("sidebar").classList.remove("open");
  document.getElementById("sidebar-scrim").classList.remove("show");
}

export function initMobileEvents() {
  const sidebar = document.getElementById("sidebar");
  const scrim = document.getElementById("sidebar-scrim");

  document.getElementById("mobile-menu-btn").addEventListener("click", () => {
    if (sidebar.classList.contains("open")) closeDrawer();
    else openDrawer();
  });

  document.getElementById("mobile-today-btn").addEventListener("click", () => {
    closeDrawer();
    openTodayView();
  });

  document.getElementById("mobile-revise-btn").addEventListener("click", () => {
    closeDrawer();
    startRevise({ type: "all" });
  });

  scrim.addEventListener("click", () => closeDrawer());

  // Picking anything in the drawer should get out of the way immediately.
  sidebar.addEventListener("click", (e) => {
    if (!isMobile()) return;
    if (e.target.closest("[data-chevron]")) return; // expanding is not navigation
    if (e.target.closest(".tree-row, .calendar-nav-btn, .next-exam, #btn-new-subject")) {
      closeDrawer();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDrawer();
  });

  // Rotating to landscape / resizing up should never leave a stuck drawer.
  window.addEventListener("resize", () => {
    if (!isMobile()) closeDrawer();
  });

  // Edge swipe from the very left opens the drawer.
  let startX = null;
  let startY = null;
  document.addEventListener(
    "touchstart",
    (e) => {
      if (!isMobile() || e.touches.length !== 1) return;
      if (document.getElementById("revise-overlay")) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    },
    { passive: true }
  );
  document.addEventListener(
    "touchend",
    (e) => {
      if (startX === null) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - startX;
      const dy = Math.abs(t.clientY - startY);
      const open = sidebar.classList.contains("open");
      if (dy < 60 && startX < 24 && dx > 60 && !open) openDrawer();
      else if (dy < 60 && dx < -60 && open) closeDrawer();
      startX = null;
      startY = null;
    },
    { passive: true }
  );
}
