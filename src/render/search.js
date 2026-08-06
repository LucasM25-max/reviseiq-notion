// Full-text search UI: a low-key magnifying-glass icon, top right, that
// expands into a search bar with results underneath. Hidden entirely while
// a quiz, practise, or test session is on screen.
import { navigateTo } from "../pages.js";
import { searchWorkspace } from "../search.js";
import { iconImg } from "../icons.js";
import { debounce, escapeHtml } from "../utils.js";

// Quiz, practise and test all render as a full-screen overlay appended
// straight into #overlay-root (plus a setup modal before that). Watching
// for these directly is simpler and more reliable than threading session
// state through three separate modules.
const SESSION_SELECTORS =
  "#quiz-overlay,#practise-overlay,#exam-overlay,.quiz-setup-overlay,.practise-setup-overlay,.exam-setup-overlay";

let wired = false;
let lastResults = [];

function isSessionActive() {
  return Boolean(document.querySelector(SESSION_SELECTORS));
}

function renderMessage(container, text) {
  container.innerHTML = '<div class="search-hint">' + escapeHtml(text) + "</div>";
}

function renderGroup(r) {
  const crumb = r.breadcrumb.length ? escapeHtml(r.breadcrumb[r.breadcrumb.length - 1]) : "";
  let html =
    '<div class="search-result-group">' +
    '<button type="button" class="search-result-page" data-search-page="' +
    r.pageId +
    '">' +
    iconImg(r.icon, 16) +
    '<span class="search-result-title">' +
    escapeHtml(r.title) +
    "</span>" +
    (crumb ? '<span class="search-result-crumb" title="' + crumb + '">' + crumb + "</span>" : "") +
    "</button>";

  r.matches.forEach((m) => {
    html +=
      '<button type="button" class="search-result-snippet" data-search-page="' +
      r.pageId +
      '" data-search-block="' +
      (m.blockId || "") +
      '">' +
      (m.label ? "<strong>" + escapeHtml(m.label) + ":</strong> " : "") +
      m.snippet +
      "</button>";
  });

  if (r.moreCount > 0) {
    html +=
      '<div class="search-result-more">+' +
      r.moreCount +
      " more match" +
      (r.moreCount === 1 ? "" : "es") +
      " on this page</div>";
  }

  html += "</div>";
  return html;
}

function renderResults(container, results, query) {
  if (results.length === 0) {
    container.innerHTML = '<div class="search-empty">No matches for \u201c' + escapeHtml(query) + '\u201d</div>';
    return;
  }
  container.innerHTML = results.map(renderGroup).join("");
}

function jumpToBlock(blockId) {
  const row = document.querySelector('.block-row[data-block-id="' + blockId + '"]');
  const main = document.getElementById("main");
  if (!row || !main) return;
  const top = row.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop - 28;
  main.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  row.classList.add("search-flash");
  setTimeout(() => row.classList.remove("search-flash"), 900);
}

export function initSearch() {
  if (wired) return;
  wired = true;

  const widget = document.getElementById("search-widget");
  const toggleBtn = document.getElementById("search-toggle-btn");
  const mobileBtn = document.getElementById("mobile-search-btn");
  const panel = document.getElementById("search-panel");
  const input = document.getElementById("search-input");
  const closeBtn = document.getElementById("search-close-btn");
  const results = document.getElementById("search-results");
  if (!widget || !panel || !input || !results) return;

  function open() {
    if (isSessionActive()) return;
    panel.hidden = false;
    widget.classList.add("open");
    input.value = "";
    lastResults = [];
    renderMessage(results, "Search page titles, notes and key terms.");
    // Wait a tick so the panel is actually visible before focusing -
    // keeps mobile keyboards well-behaved.
    setTimeout(() => input.focus(), 0);
  }

  function close() {
    panel.hidden = true;
    widget.classList.remove("open");
  }

  function toggle() {
    if (panel.hidden) open();
    else close();
  }

  const runSearch = debounce(() => {
    const q = input.value.trim();
    if (q.length < 2) {
      lastResults = [];
      renderMessage(results, q.length === 0 ? "Search page titles, notes and key terms." : "Keep typing\u2026");
      return;
    }
    lastResults = searchWorkspace(q);
    renderResults(results, lastResults, q);
  }, 150);

  if (toggleBtn) toggleBtn.addEventListener("click", toggle);
  if (mobileBtn) mobileBtn.addEventListener("click", toggle);
  if (closeBtn) closeBtn.addEventListener("click", close);

  input.addEventListener("input", runSearch);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && lastResults.length) {
      e.preventDefault();
      const first = lastResults[0];
      const blockId = first.matches[0] ? first.matches[0].blockId : null;
      close();
      navigateTo(first.pageId);
      if (blockId) setTimeout(() => jumpToBlock(blockId), 60);
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !panel.hidden) close();
  });

  document.addEventListener("mousedown", (e) => {
    if (panel.hidden) return;
    if (e.target.closest("#search-panel,#search-toggle-btn,#mobile-search-btn")) return;
    close();
  });

  results.addEventListener("click", (e) => {
    const row = e.target.closest("[data-search-page]");
    if (!row) return;
    const pageId = row.dataset.searchPage;
    const blockId = row.dataset.searchBlock || null;
    close();
    navigateTo(pageId);
    if (blockId) setTimeout(() => jumpToBlock(blockId), 60);
  });

  // Toggle visibility any time an overlay is added to or removed from
  // overlay-root, so the icon disappears the instant a quiz/practise/test
  // setup card or session opens, and reappears the instant it closes.
  const overlayRoot = document.getElementById("overlay-root");
  const syncSessionVisibility = () => {
    if (isSessionActive()) {
      close();
      widget.classList.add("session-hidden");
    } else {
      widget.classList.remove("session-hidden");
    }
  };
  if (overlayRoot) {
    const observer = new MutationObserver(syncSessionVisibility);
    observer.observe(overlayRoot, { childList: true });
  }
  syncSessionVisibility();
}
