// Floating UI: selection toolbar, link popover, slash menu, block menu,
// emoji/icon pickers and the confirm modal.
import { store, getPage, findBlockById, findContainer } from "./state.js";
import { newPageObject } from "./model.js";
import { escapeHtml, uid } from "./utils.js";
import { ICON_KEYS, CALLOUT_ICON_KEYS, iconImg, ui } from "./icons.js";
import { BLOCK_TYPES, matchBlockTypes } from "./blockTypes.js";
import { updateBlockField, convertBlockType, duplicateBlock, deleteBlockById, moveBlock } from "./blocks.js";
import { scheduleSave } from "./storage.js";
import { focusBlock } from "./focus.js";

let overlayRoot = null;

function root() {
  if (!overlayRoot) overlayRoot = document.getElementById("overlay-root");
  return overlayRoot;
}

export function closeAllFloating() {
  root()
    .querySelectorAll(".rt-toolbar,.float-menu,.ctx-menu,.link-popover,.icon-popover,.emoji-popover")
    .forEach((el) => el.remove());
}

export function initGlobalDismiss() {
  document.addEventListener("mousedown", (e) => {
    if (
      e.target.closest(
        ".rt-toolbar,.float-menu,.ctx-menu,.link-popover,.icon-popover,.emoji-popover,.block-ctrl-btn,.page-icon-btn,.callout-icon,.tree-add,.tree-menu,.page-menu-btn"
      )
    )
      return;
    closeAllFloating();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAllFloating();
  });
}

/* ---------- confirm modal ---------- */

export function showConfirmModal(opts) {
  closeAllFloating();
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML =
    '<div class="modal">' +
    "<h3>" +
    escapeHtml(opts.title) +
    "</h3><p>" +
    escapeHtml(opts.message) +
    '</p><div class="modal-actions">' +
    '<button class="btn-cancel" data-act="cancel">Cancel</button>' +
    '<button class="btn-danger" data-act="confirm">' +
    escapeHtml(opts.confirmLabel || "Delete") +
    "</button></div></div>";
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) overlay.remove();
    const btn = e.target.closest("button");
    if (btn) {
      if (btn.dataset.act === "confirm" && opts.onConfirm) opts.onConfirm();
      overlay.remove();
    }
  });
  root().appendChild(overlay);
}

/* ---------- rich text toolbar ---------- */

let activeToolbarBlockId = null;

export function maybeShowToolbar(el, blockId) {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
    removeToolbar();
    return;
  }
  if (!el.contains(sel.anchorNode)) {
    removeToolbar();
    return;
  }
  const rect = sel.getRangeAt(0).getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) {
    removeToolbar();
    return;
  }
  removeToolbar();
  activeToolbarBlockId = blockId;

  const bar = document.createElement("div");
  bar.className = "rt-toolbar";
  bar.id = "rt-toolbar";
  const items = [
    ["bold", "<b>B</b>", "bold"],
    ["italic", "<i>I</i>", "italic"],
    ["underline", "<u>U</u>", "underline"],
    ["strikeThrough", "<s>S</s>", "strikeThrough"],
    ["code", "{ }", "code"],
    ["link", ui("link", 15), "link"]
  ];
  items.forEach((it, i) => {
    if (i === 4) {
      const sep = document.createElement("div");
      sep.className = "sep";
      bar.appendChild(sep);
    }
    const b = document.createElement("button");
    b.innerHTML = it[1];
    b.dataset.cmd = it[2];
    bar.appendChild(b);
  });

  bar.style.position = "absolute";
  bar.style.top = Math.max(8, window.scrollY + rect.top - 40) + "px";
  bar.style.left = Math.max(8, window.scrollX + rect.left + rect.width / 2 - 80) + "px";
  root().appendChild(bar);

  bar.addEventListener("mousedown", (e) => e.preventDefault());
  bar.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const cmd = btn.dataset.cmd;
    el.focus();
    if (cmd === "code") {
      applyWrapTag(el, "code");
    } else if (cmd === "link") {
      showLinkPopover(bar, el);
      return;
    } else {
      document.execCommand(cmd, false, null);
    }
    const page = getPage(store.state.activePageId);
    if (page) updateBlockField(page, blockId, { content: el.innerHTML });
    scheduleSave();
  });
}

export function removeToolbar() {
  const b = document.getElementById("rt-toolbar");
  if (b) b.remove();
}

function applyWrapTag(el, tag) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  if (!range.toString()) return;
  const wrapEl = document.createElement(tag);
  try {
    range.surroundContents(wrapEl);
  } catch (e) {
    const frag = range.extractContents();
    wrapEl.appendChild(frag);
    range.insertNode(wrapEl);
  }
  sel.removeAllRanges();
  const r2 = document.createRange();
  r2.selectNodeContents(wrapEl);
  sel.addRange(r2);
}

function showLinkPopover(anchorEl, targetEl) {
  let savedRange = null;
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0) savedRange = sel.getRangeAt(0).cloneRange();
  removeToolbar();

  const pop = document.createElement("div");
  pop.className = "link-popover";
  pop.innerHTML = '<input type="text" placeholder="https://example.com" /><button>Add</button>';
  const r = anchorEl.getBoundingClientRect();
  pop.style.position = "absolute";
  pop.style.top = window.scrollY + r.bottom + 6 + "px";
  pop.style.left = window.scrollX + r.left + "px";
  root().appendChild(pop);

  const input = pop.querySelector("input");
  input.focus();

  function commit() {
    let url = input.value.trim();
    if (url && !/^https?:\/\//i.test(url)) url = "https://" + url;
    if (url && savedRange) {
      sel.removeAllRanges();
      sel.addRange(savedRange);
      const a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      try {
        savedRange.surroundContents(a);
      } catch (e) {
        const frag = savedRange.extractContents();
        a.appendChild(frag);
        savedRange.insertNode(a);
      }
      targetEl.focus();
      const page = getPage(store.state.activePageId);
      if (page && activeToolbarBlockId) updateBlockField(page, activeToolbarBlockId, { content: targetEl.innerHTML });
      scheduleSave();
    }
    pop.remove();
  }

  pop.querySelector("button").addEventListener("click", commit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    }
    if (e.key === "Escape") pop.remove();
  });
}

/* ---------- slash menu ---------- */

export function showSlashMenu(blockEl, blockId, query) {
  const filtered = matchBlockTypes(query);
  const existing = document.getElementById("slash-menu");
  let selIndex = existing ? parseInt(existing.dataset.sel || "0", 10) : 0;
  if (selIndex >= filtered.length) selIndex = 0;
  if (existing) existing.remove();

  const menu = document.createElement("div");
  menu.className = "float-menu";
  menu.id = "slash-menu";
  menu.dataset.sel = selIndex;
  renderSlashItems(menu, filtered, selIndex);

  const r = blockEl.getBoundingClientRect();
  menu.style.position = "absolute";
  menu.style.top = window.scrollY + r.bottom + 4 + "px";
  menu.style.left = window.scrollX + r.left + "px";
  root().appendChild(menu);

  menu._filtered = filtered;
  menu._blockId = blockId;
  menu.addEventListener("mousedown", (e) => {
    e.preventDefault();
    const item = e.target.closest(".menu-item");
    if (item) chooseSlashItem(blockId, filtered[parseInt(item.dataset.i, 10)]);
  });
}

export function renderSlashItems(menu, filtered, selIndex) {
  if (filtered.length === 0) {
    menu.innerHTML = '<div class="menu-empty">No matching blocks</div>';
    return;
  }
  let html = '<div class="menu-group-label">Blocks</div>';
  filtered.forEach((bt, i) => {
    html +=
      '<div class="menu-item' +
      (i === selIndex ? " selected" : "") +
      '" data-i="' +
      i +
      '"><div class="mi-icon">' +
      bt.icon +
      '</div><div class="mi-text"><div class="mi-title">' +
      bt.title +
      '</div><div class="mi-desc">' +
      bt.desc +
      "</div></div></div>";
  });
  menu.innerHTML = html;
}

// Imported lazily to avoid a circular import with pages.js -> overlays.js.
async function navigate(pageId) {
  const mod = await import("./pages.js");
  mod.navigateTo(pageId);
}

export function chooseSlashItem(blockId, bt) {
  const page = getPage(store.state.activePageId);
  if (!page || !bt) return;
  const menu = document.getElementById("slash-menu");
  if (menu) menu.remove();

  const b2 = findBlockById(page.blocks, blockId);
  if (!b2) return;

  // The slash menu only opens when a block's whole text is "/query", so the
  // typed command text is always cleared once a choice is made.
  if (b2.type === "toggle") b2.summary = "";
  else b2.content = "";

  if (bt.type === "page") {
    const c = findContainer(page.blocks, blockId);
    const newPage = newPageObject({ type: "page", title: "", parentId: page.id });
    store.state.pages[newPage.id] = newPage;
    store.state.expanded[newPage.id] = true;
    store.state.expanded[page.id] = true;
    const pageBlock = { id: uid(), type: "page", childPageId: newPage.id };
    if (c) c.arr[c.idx] = pageBlock;
    else page.blocks.push(pageBlock);
    scheduleSave();
    navigate(newPage.id);
    return;
  }

  convertBlockType(page, blockId, bt.type);
  rerenderMain();
  focusBlock(blockId, true);
  scheduleSave();
}

/* ---------- block context menu ---------- */

/* Places a floating menu under its button, nudged back on screen if needed. */
function placeMenu(menu, anchorEl, width) {
  const r = anchorEl.getBoundingClientRect();
  const w = width || 190;
  const left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8);
  menu.style.position = "absolute";
  menu.style.top = window.scrollY + r.bottom + 4 + "px";
  menu.style.left = window.scrollX + left + "px";
}

export function showBlockMenu(anchorEl, blockId) {
  closeAllFloating();
  const page = getPage(store.state.activePageId);
  const menu = document.createElement("div");
  menu.className = "ctx-menu";
  menu.innerHTML =
    '<button data-act="up"><span class="ctx-icon flip">' +
    ui("chevron", 15, 2.2) +
    "</span> Move up</button>" +
    '<button data-act="down"><span class="ctx-icon">' +
    ui("chevron", 15, 2.2) +
    "</span> Move down</button>" +
    '<button data-act="dup"><span class="ctx-icon">' +
    ui("copy", 15) +
    "</span> Duplicate</button>" +
    '<div class="ctx-divider"></div>' +
    '<button data-act="del" class="danger"><span class="ctx-icon">' +
    ui("trash", 15) +
    "</span> Delete</button>";
  placeMenu(menu, anchorEl, 190);
  root().appendChild(menu);

  menu.addEventListener("mousedown", (e) => {
    e.preventDefault();
    const btn = e.target.closest("button");
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === "up" || act === "down") {
      const c = findContainer(page.blocks, blockId);
      if (c) {
        const to = act === "up" ? c.idx - 1 : c.idx + 1;
        if (to >= 0 && to < c.arr.length) {
          moveBlock(c.arr, c.idx, to);
          rerenderMain();
          scheduleSave();
        }
      }
    }
    if (act === "dup") {
      duplicateBlock(page, blockId);
      rerenderMain();
      scheduleSave();
    }
    if (act === "del") {
      const prev = deleteBlockById(page, blockId);
      rerenderMain();
      if (prev) focusBlock(prev, true);
      scheduleSave();
    }
    menu.remove();
  });
}

/*
 * Page options, shown from the sidebar row and the page header. The caller
 * supplies the actions so this module never has to import pages.js, which
 * imports this one.
 */
export function showPageMenu(anchorEl, pageId, handlers) {
  closeAllFloating();
  const menu = document.createElement("div");
  menu.className = "ctx-menu";
  menu.innerHTML =
    '<button data-act="add"><span class="ctx-icon">' +
    ui("plus", 15, 2.2) +
    "</span> Add subpage</button>" +
    '<button data-act="rename"><span class="ctx-icon">' +
    ui("text", 15) +
    "</span> Rename</button>" +
    '<div class="ctx-divider"></div>' +
    '<button data-act="del" class="danger"><span class="ctx-icon">' +
    ui("trash", 15) +
    "</span> Delete page</button>";
  placeMenu(menu, anchorEl, 190);
  root().appendChild(menu);

  menu.addEventListener("mousedown", (e) => {
    e.preventDefault();
    const btn = e.target.closest("button");
    if (!btn) return;
    const act = btn.dataset.act;
    menu.remove();
    if (act === "add" && handlers.onAddChild) handlers.onAddChild(pageId);
    if (act === "rename" && handlers.onRename) handlers.onRename(pageId);
    if (act === "del" && handlers.onDelete) handlers.onDelete(pageId);
  });
}

/* ---------- pickers ---------- */

export function showIconPicker(anchorEl, onPick) {
  const pop = document.createElement("div");
  pop.className = "icon-popover";
  pop.innerHTML = ICON_KEYS.map(
    (key) => '<button type="button" data-icon="' + key + '" title="' + key + '">' + iconImg(key, 22) + "</button>"
  ).join("");
  positionPopover(pop, anchorEl, 6);
  pop.addEventListener("mousedown", (e) => {
    e.preventDefault();
    const btn = e.target.closest("button");
    if (!btn) return;
    onPick(btn.dataset.icon);
    pop.remove();
  });
}

export function showCalloutEmojiPicker(anchorEl, onPick) {
  const pop = document.createElement("div");
  pop.className = "emoji-popover";
  pop.innerHTML = CALLOUT_ICON_KEYS.map(
    (key) => '<button type="button" data-icon="' + key + '" title="' + key + '">' + iconImg(key, 20) + "</button>"
  ).join("");
  positionPopover(pop, anchorEl, 4);
  pop.addEventListener("mousedown", (e) => {
    e.preventDefault();
    const btn = e.target.closest("button");
    if (!btn) return;
    onPick(btn.dataset.icon);
    pop.remove();
  });
}

function positionPopover(pop, anchorEl, gap) {
  const r = anchorEl.getBoundingClientRect();
  pop.style.position = "absolute";
  pop.style.top = window.scrollY + r.bottom + gap + "px";
  pop.style.left = window.scrollX + r.left + "px";
  root().appendChild(pop);
}

// Re-render hook, injected by main.js to keep this module free of render imports.
let rerenderMain = () => {};
export function setRerenderMain(fn) {
  rerenderMain = fn;
}
