// Fixed "On this page" contents rail, built from the heading blocks of the
// page that is currently open.
import { store, getPage } from "../state.js";
import { escapeHtml } from "../utils.js";

const LEVELS = { heading1: 1, heading2: 2, heading3: 3 };

function plainText(html) {
  const tmp = document.createElement("div");
  tmp.innerHTML = html || "";
  return (tmp.textContent || "").replace(/\s+/g, " ").trim();
}

function collectHeadings(blocks, out) {
  blocks.forEach((b) => {
    if (!b || typeof b !== "object") return;
    if (LEVELS[b.type]) {
      const text = plainText(b.content);
      if (text) out.push({ id: b.id, level: LEVELS[b.type], text });
    }
    if (b.type === "toggle" && !b.collapsed && Array.isArray(b.children)) collectHeadings(b.children, out);
  });
  return out;
}

export function renderToc() {
  const rail = document.getElementById("toc-rail");
  if (!rail) return;
  ensureWired();

  const page = store.currentView === "page" ? getPage(store.state.activePageId) : null;
  const headings = page ? collectHeadings(page.blocks, []) : [];

  if (headings.length === 0) {
    rail.innerHTML = "";
    rail.classList.remove("has-items");
    return;
  }

  rail.classList.add("has-items");
  rail.innerHTML =
    '<div class="toc-label">On this page</div><div class="toc-items">' +
    headings
      .map(
        (h) =>
          '<button type="button" class="toc-item lvl-' +
          h.level +
          '" data-toc-target="' +
          h.id +
          '" title="' +
          escapeHtml(h.text) +
          '"><span class="toc-dash"></span><span class="toc-text">' +
          escapeHtml(h.text) +
          "</span></button>"
      )
      .join("") +
    "</div>";

  highlightActive();
}

function scrollToBlock(blockId) {
  const row = document.querySelector('.block-row[data-block-id="' + blockId + '"]');
  const main = document.getElementById("main");
  if (!row || !main) return;
  const top = row.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop - 28;
  main.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  const editable = row.querySelector(".rt");
  if (editable) {
    row.classList.add("toc-flash");
    setTimeout(() => row.classList.remove("toc-flash"), 700);
  }
}

function highlightActive() {
  const rail = document.getElementById("toc-rail");
  const main = document.getElementById("main");
  if (!rail || !main || !rail.classList.contains("has-items")) return;
  const items = rail.querySelectorAll(".toc-item");
  const mainTop = main.getBoundingClientRect().top;
  let activeId = null;
  items.forEach((item) => {
    const row = document.querySelector('.block-row[data-block-id="' + item.dataset.tocTarget + '"]');
    if (!row) return;
    if (row.getBoundingClientRect().top - mainTop <= 120) activeId = item.dataset.tocTarget;
  });
  if (!activeId && items.length) activeId = items[0].dataset.tocTarget;
  items.forEach((item) => item.classList.toggle("active", item.dataset.tocTarget === activeId));
}

let wired = false;
let rafPending = false;
let typingTimer = null;

function ensureWired() {
  if (wired) return;
  wired = true;

  const rail = document.getElementById("toc-rail");
  if (rail) {
    rail.addEventListener("click", (e) => {
      const item = e.target.closest("[data-toc-target]");
      if (item) scrollToBlock(item.dataset.tocTarget);
    });
  }

  const main = document.getElementById("main");
  if (main) {
    main.addEventListener(
      "scroll",
      () => {
        if (rafPending) return;
        rafPending = true;
        requestAnimationFrame(() => {
          rafPending = false;
          highlightActive();
        });
      },
      { passive: true }
    );
  }

  // Keep the rail in sync while headings are being typed.
  document.addEventListener("input", (e) => {
    const t = e.target;
    if (!t || !t.classList || !t.classList.contains("rt")) return;
    const row = t.closest(".block-row");
    if (!row || !LEVELS[row.dataset.blockType]) return;
    if (typingTimer) clearTimeout(typingTimer);
    typingTimer = setTimeout(renderToc, 250);
  });
}
