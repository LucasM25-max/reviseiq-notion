// All interaction wiring for the main editor panel.
import { store, getPage, findBlockById, findContainer } from "../state.js";
import { newBlock } from "../model.js";
import { escapeHtml, sanitizeHtmlFragment, compressImageFile, extractYouTubeId } from "../utils.js";
import {
  insertBlockAfter,
  updateBlockField,
  convertBlockType,
  containerKeyFor,
  moveBlock
} from "../blocks.js";
import { scheduleSave } from "../storage.js";
import { renderMain } from "../render/main.js";
import { renderSidebar } from "../render/sidebar.js";
import {
  showConfirmModal,
  showIconPicker,
  showCalloutEmojiPicker,
  showBlockMenu,
  showSlashMenu,
  renderSlashItems,
  chooseSlashItem,
  maybeShowToolbar,
  removeToolbar
} from "../overlays.js";
import { startRevise } from "../render/revise.js";
import {
  navigateTo,
  deletePage,
  createSubjectPage,
  renamePage,
  setPageIcon,
  setExamBoard,
  setExamBoardOther,
  addExamDate,
  removeExamDate
} from "../pages.js";
import { focusBlock, focusBlockAtOffset, isCursorAtStart, splitAtCursor, normalizeEmptyContent } from "../focus.js";

export function initMainEvents() {
  const mainInner = document.getElementById("main-inner");

  mainInner.addEventListener("click", (e) => {
    const page = getPage(store.state.activePageId);

    const delPage = e.target.closest("[data-del-page]");
    if (delPage) {
      e.stopPropagation();
      const pid = delPage.dataset.delPage;
      const pg = getPage(pid);
      showConfirmModal({
        title: "Delete this page?",
        message: 'This will permanently delete "' + (pg ? pg.title || "Untitled" : "this page") + '" and all of its subpages. This can\u2019t be undone.',
        confirmLabel: "Delete",
        onConfirm: () => {
          deletePage(pid);
          renderSidebar();
          renderMain();
        }
      });
      return;
    }

    const navEl = e.target.closest("[data-nav]");
    if (navEl) {
      navigateTo(navEl.dataset.nav);
      return;
    }

    if (e.target.closest("#empty-new-subject")) {
      createSubjectPage("");
      return;
    }

    const iconBtn = e.target.closest("#page-icon-btn");
    if (iconBtn) {
      showIconPicker(iconBtn, (icon) => setPageIcon(iconBtn.dataset.pageId, icon));
      return;
    }

    if (!page) return;

    const plusBtn = e.target.closest("[data-plus]");
    if (plusBtn) {
      const nb = newBlock("paragraph");
      insertBlockAfter(page, plusBtn.dataset.plus, nb);
      renderMain();
      focusBlock(nb.id, true);
      scheduleSave();
      return;
    }

    const handleBtn = e.target.closest("[data-handle]");
    if (handleBtn) {
      showBlockMenu(handleBtn, handleBtn.dataset.handle);
      return;
    }

    // Clicking the empty space under the last block starts a new paragraph,
    // so no permanent "add a block" row is needed.
    if (e.target.closest("#page-tail")) {
      const last = page.blocks[page.blocks.length - 1];
      if (last && last.type === "paragraph" && !(last.content || "").trim()) {
        focusBlock(last.id, true);
        return;
      }
      const nb2 = newBlock("paragraph");
      if (last) insertBlockAfter(page, last.id, nb2);
      else page.blocks.push(nb2);
      renderMain();
      focusBlock(nb2.id, true);
      scheduleSave();
      return;
    }

    const reviseBtn = e.target.closest("#revise-page-btn");
    if (reviseBtn) {
      startRevise({ type: "page", pageId: reviseBtn.dataset.pageId });
      return;
    }

    const addInToggle = e.target.closest("[data-add-in-toggle]");
    if (addInToggle) {
      const tb = findBlockById(page.blocks, addInToggle.dataset.addInToggle);
      if (tb) {
        const nb3 = newBlock("paragraph");
        tb.children.push(nb3);
        renderMain();
        focusBlock(nb3.id, true);
        scheduleSave();
      }
      return;
    }

    const toggleArrow = e.target.closest("[data-toggle-arrow]");
    if (toggleArrow) {
      const tgB = findBlockById(page.blocks, toggleArrow.dataset.toggleArrow);
      if (tgB) {
        tgB.collapsed = !tgB.collapsed;
        renderMain();
        scheduleSave();
      }
      return;
    }

    const todoCheck = e.target.closest("[data-todo-check]");
    if (todoCheck) {
      const tdB = findBlockById(page.blocks, todoCheck.dataset.todoCheck);
      if (tdB) {
        tdB.checked = !tdB.checked;
        renderMain();
        scheduleSave();
      }
      return;
    }

    const calloutIcon = e.target.closest("[data-callout-icon]");
    if (calloutIcon) {
      const coId = calloutIcon.dataset.calloutIcon;
      showCalloutEmojiPicker(calloutIcon, (emoji) => {
        const b = findBlockById(page.blocks, coId);
        if (b) {
          b.icon = emoji;
          renderMain();
          scheduleSave();
        }
      });
      return;
    }

    const addExamBtn = e.target.closest("#add-exam-btn");
    if (addExamBtn) {
      const wrap = document.createElement("div");
      wrap.className = "exam-form";
      wrap.innerHTML =
        '<input type="text" placeholder="e.g. Paper 1: Biology" class="exam-name-input" />' +
        '<input type="date" class="exam-date-input" />' +
        '<button class="save-btn" type="button">Add</button>' +
        '<button class="cancel-btn" type="button">Cancel</button>';
      addExamBtn.replaceWith(wrap);
      wrap.querySelector(".exam-name-input").focus();
      wrap.querySelector(".save-btn").addEventListener("click", () => {
        const name = wrap.querySelector(".exam-name-input").value.trim();
        const date = wrap.querySelector(".exam-date-input").value;
        if (name && date) {
          addExamDate(page.id, name, date);
          renderMain();
          renderSidebar();
        }
      });
      wrap.querySelector(".cancel-btn").addEventListener("click", () => renderMain());
      return;
    }

    const removeExamBtn = e.target.closest("[data-remove-exam]");
    if (removeExamBtn) {
      removeExamDate(page.id, removeExamBtn.dataset.removeExam);
      renderMain();
      renderSidebar();
      return;
    }

    const imgUpload = e.target.closest("[data-image-upload]");
    if (imgUpload) {
      const input = imgUpload.parentElement.querySelector("[data-image-input]");
      if (input) input.click();
      return;
    }
    const imgDropArea = e.target.closest("[data-image-drop]");
    if (imgDropArea && e.target === imgDropArea) {
      const input2 = imgDropArea.querySelector("[data-image-input]");
      if (input2) input2.click();
      return;
    }

    const videoBtn = e.target.closest("[data-video-embed]");
    if (videoBtn) {
      commitVideoEmbed(videoBtn.dataset.videoEmbed);
      return;
    }

    const tAddRow = e.target.closest("[data-table-add-row]");
    if (tAddRow) {
      const tb1 = findBlockById(page.blocks, tAddRow.dataset.tableAddRow);
      if (tb1) {
        const cols = tb1.rows[0] ? tb1.rows[0].length : 2;
        tb1.rows.push(new Array(cols).fill(""));
        renderMain();
        scheduleSave();
      }
      return;
    }
    const tAddCol = e.target.closest("[data-table-add-col]");
    if (tAddCol) {
      const tb2 = findBlockById(page.blocks, tAddCol.dataset.tableAddCol);
      if (tb2) {
        tb2.rows.forEach((r) => r.push(""));
        renderMain();
        scheduleSave();
      }
      return;
    }
    const tDelRow = e.target.closest("[data-table-del-row]");
    if (tDelRow) {
      const tb3 = findBlockById(page.blocks, tDelRow.dataset.tableDelRow);
      if (tb3 && tb3.rows.length > 1) {
        tb3.rows.pop();
        renderMain();
        scheduleSave();
      }
      return;
    }
    const tDelCol = e.target.closest("[data-table-del-col]");
    if (tDelCol) {
      const tb4 = findBlockById(page.blocks, tDelCol.dataset.tableDelCol);
      if (tb4 && tb4.rows[0] && tb4.rows[0].length > 1) {
        tb4.rows.forEach((r) => r.pop());
        renderMain();
        scheduleSave();
      }
    }
  });

  mainInner.addEventListener("change", (e) => {
    const page = getPage(store.state.activePageId);
    if (!page) return;

    const boardSel = e.target.closest("#board-select");
    if (boardSel) {
      setExamBoard(page.id, boardSel.value);
      renderMain();
      return;
    }
    const boardOther = e.target.closest("#board-other");
    if (boardOther) {
      setExamBoardOther(page.id, boardOther.value);
      return;
    }
    const imgInput = e.target.closest("[data-image-input]");
    if (imgInput && imgInput.files && imgInput.files[0]) {
      handleImageForBlock(imgInput.dataset.imageInput, imgInput.files[0]);
    }
  });

  mainInner.addEventListener("input", (e) => {
    const page = getPage(store.state.activePageId);
    if (!page) return;
    const t = e.target;

    if (t.id === "page-title") {
      renamePage(page.id, t.textContent);
      renderSidebar();
      const curCrumb = mainInner.querySelector(".crumb.current .crumb-text");
      if (curCrumb) curCrumb.textContent = t.textContent || "Untitled";
      return;
    }
    if (t.classList.contains("board-other")) return;

    if (t.matches("[data-code-lang]")) {
      updateBlockField(page, t.dataset.codeLang, { lang: t.value });
      scheduleSave();
      return;
    }
    if (t.matches("[data-code-area]")) {
      updateBlockField(page, t.dataset.codeArea, { content: t.value });
      t.style.height = "auto";
      t.style.height = t.scrollHeight + 4 + "px";
      scheduleSave();
      return;
    }
    if (t.matches("[data-table-cell]")) {
      const b = findBlockById(page.blocks, t.dataset.tableCell);
      if (b) {
        b.rows[parseInt(t.dataset.r, 10)][parseInt(t.dataset.c, 10)] = t.textContent;
        scheduleSave();
      }
      return;
    }
    if (t.matches("[data-image-caption]")) {
      updateBlockField(page, t.dataset.imageCaption, { caption: t.textContent });
      scheduleSave();
      return;
    }

    if (t.classList.contains("rt")) {
      const row = t.closest(".block-row");
      if (!row) return;
      const blockId = row.dataset.blockId;
      const isSummary = t.closest(".toggle-row") !== null && row.dataset.blockType === "toggle";
      const html = normalizeEmptyContent(t.innerHTML);
      updateBlockField(page, blockId, isSummary ? { summary: html } : { content: html });
      scheduleSave();

      const text = t.textContent;
      if (text.charAt(0) === "/") {
        showSlashMenu(t, blockId, text.slice(1));
      } else {
        const sm = document.getElementById("slash-menu");
        if (sm) sm.remove();
      }
    }
  });

  mainInner.addEventListener("focusout", (e) => {
    if (e.target.classList && e.target.classList.contains("rt")) removeToolbar();
  });

  mainInner.addEventListener("mouseup", (e) => {
    const rt = e.target.closest(".rt");
    if (rt) {
      const row = rt.closest(".block-row");
      const blockId = row ? row.dataset.blockId : null;
      setTimeout(() => maybeShowToolbar(rt, blockId), 0);
    }
  });

  mainInner.addEventListener("keyup", (e) => {
    if (["Shift", "Control", "Alt", "Meta"].indexOf(e.key) > -1) return;
    const rt = e.target.closest ? e.target.closest(".rt") : null;
    if (rt && window.getSelection().toString().length > 0) {
      const row = rt.closest(".block-row");
      maybeShowToolbar(rt, row ? row.dataset.blockId : null);
    } else if (rt) {
      removeToolbar();
    }
  });

  mainInner.addEventListener("keydown", (e) => {
    const page = getPage(store.state.activePageId);
    const t = e.target;

    if (t.id === "page-title" && e.key === "Enter") {
      e.preventDefault();
      t.blur();
      return;
    }
    if (!page || !t.classList || !t.classList.contains("rt")) return;

    const row = t.closest(".block-row");
    if (!row) return;
    const blockId = row.dataset.blockId;
    const blockType = row.dataset.blockType;
    const block = findBlockById(page.blocks, blockId);
    if (!block) return;

    const slashMenu = document.getElementById("slash-menu");
    if (slashMenu) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const filtered = slashMenu._filtered || [];
        let sel = parseInt(slashMenu.dataset.sel || "0", 10);
        sel = e.key === "ArrowDown" ? Math.min(filtered.length - 1, sel + 1) : Math.max(0, sel - 1);
        slashMenu.dataset.sel = sel;
        renderSlashItems(slashMenu, filtered, sel);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const filtered2 = slashMenu._filtered || [];
        const sel2 = parseInt(slashMenu.dataset.sel || "0", 10);
        if (filtered2[sel2]) chooseSlashItem(blockId, filtered2[sel2]);
        return;
      }
      if (e.key === "Escape") {
        slashMenu.remove();
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const parts = splitAtCursor(t);
      const beforeHtml = normalizeEmptyContent(parts.before);
      const afterHtml = normalizeEmptyContent(parts.after);

      if (blockType === "toggle") {
        updateBlockField(page, blockId, { summary: beforeHtml });
        const nb = newBlock("paragraph");
        nb.content = afterHtml;
        block.children.unshift(nb);
        renderMain();
        focusBlock(nb.id, false);
        scheduleSave();
        return;
      }

      updateBlockField(page, blockId, { content: beforeHtml });
      const continueType = blockType === "bulleted" || blockType === "numbered" || blockType === "todo" ? blockType : "paragraph";
      if (continueType !== "paragraph" && beforeHtml === "" && afterHtml === "") {
        convertBlockType(page, blockId, "paragraph");
        renderMain();
        focusBlock(blockId, false);
        scheduleSave();
        return;
      }
      const nb2 = newBlock(continueType);
      nb2.content = afterHtml;
      insertBlockAfter(page, blockId, nb2);
      renderMain();
      focusBlock(nb2.id, false);
      scheduleSave();
      return;
    }

    if (e.key === "Backspace") {
      if (!isCursorAtStart(t)) return;
      const c = findContainer(page.blocks, blockId);
      if (!c) return;
      const isEmpty = blockType === "toggle" ? (block.summary || "") === "" : (block.content || "") === "";

      if (blockType !== "paragraph" && isEmpty) {
        e.preventDefault();
        convertBlockType(page, blockId, "paragraph");
        renderMain();
        focusBlock(blockId, false);
        scheduleSave();
        return;
      }
      if (c.idx === 0) return;

      const prevBlock = c.arr[c.idx - 1];
      const mergeable = ["paragraph", "heading1", "heading2", "heading3", "quote", "bulleted", "numbered", "todo"];
      if (mergeable.indexOf(prevBlock.type) > -1) {
        e.preventDefault();
        const prevLen = (prevBlock.content || "").replace(/<[^>]+>/g, "").length;
        prevBlock.content = (prevBlock.content || "") + (block.content || "");
        c.arr.splice(c.idx, 1);
        renderMain();
        focusBlockAtOffset(prevBlock.id, prevLen);
        scheduleSave();
        return;
      }
      if (isEmpty) {
        e.preventDefault();
        c.arr.splice(c.idx, 1);
        if (page.blocks.length === 0) page.blocks.push(newBlock("paragraph"));
        renderMain();
        focusBlock(prevBlock.id, true);
        scheduleSave();
      }
    }
  });

  /* ---------- paste ---------- */

  mainInner.addEventListener("paste", (e) => {
    const t = e.target;
    const items = e.clipboardData ? e.clipboardData.items : null;
    if (items) {
      for (let i = 0; i < items.length; i++) {
        if (items[i].type && items[i].type.indexOf("image/") === 0) {
          e.preventDefault();
          const file = items[i].getAsFile();
          if (file) handleImagePaste(t, file);
          return;
        }
      }
    }
    if (t.classList && t.classList.contains("rt")) {
      e.preventDefault();
      const html = e.clipboardData.getData("text/html");
      const text = e.clipboardData.getData("text/plain");
      const clean = html ? sanitizeHtmlFragment(html) : escapeHtml(text).replace(/\n/g, "<br>");
      document.execCommand("insertHTML", false, clean);
      const row = t.closest(".block-row");
      if (row) {
        const page = getPage(store.state.activePageId);
        const isSummary = row.dataset.blockType === "toggle";
        const patch = isSummary
          ? { summary: normalizeEmptyContent(t.innerHTML) }
          : { content: normalizeEmptyContent(t.innerHTML) };
        updateBlockField(page, row.dataset.blockId, patch);
        scheduleSave();
      }
    }
  });

  function handleImagePaste(target, file) {
    const page = getPage(store.state.activePageId);
    const row = target.closest ? target.closest(".block-row") : null;
    const afterId = row ? row.dataset.blockId : page.blocks.length ? page.blocks[page.blocks.length - 1].id : null;
    const imgBlock = newBlock("image");
    if (afterId) insertBlockAfter(page, afterId, imgBlock);
    else page.blocks.push(imgBlock);
    renderMain();
    compressImageFile(file)
      .then((dataUrl) => {
        updateBlockField(page, imgBlock.id, { src: dataUrl });
        if (store.state.activePageId === page.id) renderMain();
        scheduleSave();
      })
      .catch(() => {
        updateBlockField(page, imgBlock.id, { caption: "" });
        if (store.state.activePageId === page.id) renderMain();
      });
  }

  function handleImageForBlock(blockId, file) {
    const page = getPage(store.state.activePageId);
    compressImageFile(file)
      .then((dataUrl) => {
        updateBlockField(page, blockId, { src: dataUrl });
        renderMain();
        scheduleSave();
      })
      .catch((err) => {
        const el = document.querySelector('[data-image-drop="' + blockId + '"]');
        if (el) {
          const msg = document.createElement("div");
          msg.style.cssText = "color:var(--danger);font-size:12px;margin-top:4px;";
          msg.textContent = err.message || "Couldn't add that image.";
          el.appendChild(msg);
        }
      });
  }

  /* ---------- image drag & drop ---------- */

  mainInner.addEventListener("dragover", (e) => {
    const dz = e.target.closest("[data-image-drop]");
    if (dz) {
      e.preventDefault();
      dz.classList.add("drag-active");
    }
  });
  mainInner.addEventListener("dragleave", (e) => {
    const dz = e.target.closest("[data-image-drop]");
    if (dz) dz.classList.remove("drag-active");
  });
  mainInner.addEventListener("drop", (e) => {
    const dz = e.target.closest("[data-image-drop]");
    if (dz) {
      e.preventDefault();
      dz.classList.remove("drag-active");
      const file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) handleImageForBlock(dz.dataset.imageDrop, file);
    }
  });

  /* ---------- video ---------- */

  function commitVideoEmbed(blockId) {
    const page = getPage(store.state.activePageId);
    const input = document.querySelector('[data-video-input="' + blockId + '"]');
    const errEl = document.querySelector('[data-video-error="' + blockId + '"]');
    if (!input) return;
    const id = extractYouTubeId(input.value);
    if (!id) {
      if (errEl) {
        errEl.style.display = "block";
        errEl.textContent = "Couldn't find a video at that link \u2014 check the URL and try again.";
      }
      return;
    }
    updateBlockField(page, blockId, { videoId: id });
    renderMain();
    scheduleSave();
  }

  mainInner.addEventListener(
    "keydown",
    (e) => {
      const input = e.target.closest ? e.target.closest("[data-video-input]") : null;
      if (input && e.key === "Enter") {
        e.preventDefault();
        commitVideoEmbed(input.dataset.videoInput);
      }
    },
    true
  );

  /* ---------- block reordering ---------- */

  let dragState = null;

  mainInner.addEventListener("dragstart", (e) => {
    const handle = e.target.closest("[data-handle]");
    if (!handle) {
      e.preventDefault();
      return;
    }
    const blockId = handle.dataset.handle;
    const page = getPage(store.state.activePageId);
    dragState = { blockId, containerKey: containerKeyFor(page, blockId) };
    const row = handle.closest(".block-row");
    if (row) row.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    try {
      e.dataTransfer.setData("text/plain", blockId);
    } catch (err) {
      /* some browsers disallow this during dragstart */
    }
  });

  mainInner.addEventListener("dragover", (e) => {
    if (!dragState) return;
    const row = e.target.closest(".block-row");
    if (!row) return;
    const page = getPage(store.state.activePageId);
    if (containerKeyFor(page, row.dataset.blockId) !== dragState.containerKey) return;
    e.preventDefault();
    const rect = row.getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    document.querySelectorAll(".block-row.drag-over-top,.block-row.drag-over-bottom").forEach((el) => {
      el.classList.remove("drag-over-top", "drag-over-bottom");
    });
    row.classList.add(e.clientY < mid ? "drag-over-top" : "drag-over-bottom");
  });

  mainInner.addEventListener("drop", (e) => {
    if (!dragState) return;
    const row = e.target.closest(".block-row");
    document.querySelectorAll(".block-row.drag-over-top,.block-row.drag-over-bottom").forEach((el) => {
      el.classList.remove("drag-over-top", "drag-over-bottom");
    });
    if (!row) {
      dragState = null;
      return;
    }
    e.preventDefault();
    const page = getPage(store.state.activePageId);
    if (containerKeyFor(page, row.dataset.blockId) !== dragState.containerKey) {
      dragState = null;
      return;
    }
    const c = findContainer(page.blocks, dragState.blockId);
    const targetC = findContainer(page.blocks, row.dataset.blockId);
    if (!c || !targetC || c.arr !== targetC.arr) {
      dragState = null;
      return;
    }
    const fromIdx = c.idx;
    let toIdx = targetC.idx;
    const rect = row.getBoundingClientRect();
    if (e.clientY > rect.top + rect.height / 2) toIdx += 1;
    if (fromIdx < toIdx) toIdx -= 1;
    moveBlock(c.arr, fromIdx, toIdx);
    dragState = null;
    renderMain();
    scheduleSave();
  });

  mainInner.addEventListener("dragend", () => {
    document.querySelectorAll(".block-row.dragging").forEach((el) => el.classList.remove("dragging"));
    document.querySelectorAll(".block-row.drag-over-top,.block-row.drag-over-bottom").forEach((el) => {
      el.classList.remove("drag-over-top", "drag-over-bottom");
    });
    dragState = null;
  });
}
