// All interaction wiring for the main editor panel.
import { store, getPage, findBlockById, findContainer } from "../state.js";
import { newBlock, newTimelineItem } from "../model.js";
import { escapeHtml, sanitizeHtmlFragment, compressImageFile, extractYouTubeId } from "../utils.js";
import {
  insertBlockAfter,
  updateBlockField,
  convertBlockType,
  containerKeyFor,
  moveBlock
} from "../blocks.js";
import { scheduleSave } from "../storage.js";
import { renderMain, renderBlocksOnly } from "../render/main.js";
import { renderSidebar } from "../render/sidebar.js";
import {
  showConfirmModal,
  showIconPicker,
  showCalloutEmojiPicker,
  showBlockMenu,
  showPageMenu,
  showSlashMenu,
  renderSlashItems,
  chooseSlashItem,
  maybeShowToolbar,
  removeToolbar
} from "../overlays.js";
import { startFlashcards, setFlashcardsNextTask } from "../render/flashcards.js";
import { openPrintDialog } from "../print.js";
import {
  togglePlanSettings,
  togglePlanTimeline,
  togglePlanProgress,
  togglePlanList,
  expandPlanTask
} from "../render/plan.js";
import {
  planSettings,
  saveSetup,
  minutesForMode,
  regeneratePlan,
  toggleTaskDone,
  skipTask,
  todayTasks,
  isTaskDone,
  isTaskSkipped,
  pullForward,
  undoPull,
  ensurePlan,
  noteTaskStart,
  addMinutesPerDay,
  setNarrowScope,
  dismissDigest
} from "../plan/store.js";
import { openTestSetup, resumeAttempt, openResults } from "../exam/session.js";
import { openQuizSetup, resumeQuiz, openQuizResults } from "../quiz/session.js";
import { openPractiseSetup, resumePractise, openPractiseResults } from "../practise/session.js";
import { toggleWorkList } from "../render/work.js";
import { resolveInsight } from "../exam/insights.js";
import {
  navigateTo,
  deletePage,
  confirmDeletePage,
  createChildPage,
  createSubjectPage,
  renamePage,
  setPageIcon,
  setExamBoard,
  setExamBoardOther,
  addExamDate,
  removeExamDate
} from "../pages.js";
import { focusBlock, focusBlockAtOffset, isCursorAtStart, splitAtCursor, normalizeEmptyContent } from "../focus.js";

/* Puts the caret in one field of one timeline entry. */
function focusTimelineField(itemId, field) {
  const el = document.querySelector('[data-tl-item="' + itemId + '"] [data-tl-field="' + field + '"]');
  if (el) focusTitleEnd(el);
}

/* Puts the caret at the end of the page title, for the Rename action. */
function focusTitleEnd(el) {
  el.focus();
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

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

    // Plan view: settings, task ticking, skipping, and starting work.
    if (handlePlanClick(e)) return;

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
      renderBlocksOnly();
      focusBlock(nb.id, true);
      scheduleSave();
      return;
    }

    const pageMenuBtn = e.target.closest("[data-page-menu]");
    if (pageMenuBtn) {
      e.stopPropagation();
      const pid = pageMenuBtn.dataset.pageMenu;
      showPageMenu(pageMenuBtn, pid, {
        onAddChild: (id) => createChildPage(id, ""),
        onRename: () => {
          const el = document.getElementById("page-title");
          if (el) focusTitleEnd(el);
        },
        onPrint: (id) => openPrintDialog(id),
        onDelete: (id) => confirmDeletePage(id)
      });
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
      renderBlocksOnly();
      focusBlock(nb2.id, true);
      scheduleSave();
      return;
    }

    const reviseBtn = e.target.closest("#revise-page-btn");
    if (reviseBtn) {
      startFlashcards({ type: "page", pageId: reviseBtn.dataset.pageId });
      return;
    }

    const quizBtn = e.target.closest("#quiz-me-btn");
    if (quizBtn) {
      openQuizSetup(quizBtn.dataset.pageId);
      return;
    }

    const quizAct = e.target.closest("[data-quiz-act]");
    if (quizAct) {
      if (quizAct.dataset.quizAct === "resume") resumeQuiz(quizAct.dataset.quizId);
      else openQuizResults(quizAct.dataset.quizId);
      return;
    }

    const workToggle = e.target.closest("[data-work-toggle]");
    if (workToggle) {
      toggleWorkList(workToggle.dataset.workToggle);
      renderMain();
      return;
    }

    const practiseBtn = e.target.closest("#practise-me-btn");
    if (practiseBtn) {
      openPractiseSetup(practiseBtn.dataset.pageId);
      return;
    }

    const practiseOpen = e.target.closest("[data-practise-open]");
    if (practiseOpen) {
      if (practiseOpen.dataset.practiseOpen === "resume") resumePractise(practiseOpen.dataset.practiseId);
      else openPractiseResults(practiseOpen.dataset.practiseId);
      return;
    }

    const testBtn = e.target.closest("#test-me-btn");
    if (testBtn) {
      openTestSetup(testBtn.dataset.pageId);
      return;
    }

    const testAct = e.target.closest("[data-test-act]");
    if (testAct) {
      if (testAct.dataset.testAct === "resume") resumeAttempt(testAct.dataset.testId);
      else openResults(testAct.dataset.testId);
      return;
    }

    const insightAct = e.target.closest("[data-insight-act]");
    if (insightAct) {
      const act = insightAct.dataset.insightAct;
      if (act === "resolve") {
        resolveInsight(insightAct.dataset.insightId);
        scheduleSave();
        renderMain();
      } else if (act === "expand") {
        const section = insightAct.closest(".feedback-section");
        if (section) section.classList.add("is-expanded");
        insightAct.remove();
      }
      return;
    }

    const addInToggle = e.target.closest("[data-add-in-toggle]");
    if (addInToggle) {
      const tb = findBlockById(page.blocks, addInToggle.dataset.addInToggle);
      if (tb) {
        const nb3 = newBlock("paragraph");
        tb.children.push(nb3);
        renderBlocksOnly();
        focusBlock(nb3.id, true);
        scheduleSave();
      }
      return;
    }

    const addInCallout = e.target.closest("[data-add-in-callout]");
    if (addInCallout) {
      const cb = findBlockById(page.blocks, addInCallout.dataset.addInCallout);
      if (cb) {
        if (!Array.isArray(cb.children)) cb.children = [];
        const nb4 = newBlock("paragraph");
        cb.children.push(nb4);
        renderBlocksOnly();
        focusBlock(nb4.id, true);
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

    const tlAdd = e.target.closest("[data-tl-add]");
    if (tlAdd) {
      const tlb = findBlockById(page.blocks, tlAdd.dataset.tlAdd);
      if (tlb) {
        if (!Array.isArray(tlb.items)) tlb.items = [];
        const item = newTimelineItem();
        tlb.items.push(item);
        renderBlocksOnly();
        focusTimelineField(item.id, "date");
        scheduleSave();
      }
      return;
    }
    const tlDel = e.target.closest("[data-tl-del]");
    if (tlDel) {
      const wrap = tlDel.closest("[data-tl-block]");
      const tlb2 = wrap ? findBlockById(page.blocks, wrap.dataset.tlBlock) : null;
      if (tlb2 && Array.isArray(tlb2.items)) {
        tlb2.items = tlb2.items.filter((it) => it.id !== tlDel.dataset.tlDel);
        if (!tlb2.items.length) tlb2.items.push(newTimelineItem());
        renderBlocksOnly();
        scheduleSave();
      }
      return;
    }

    const tAddRow = e.target.closest("[data-table-add-row]");
    if (tAddRow) {
      const tb1 = findBlockById(page.blocks, tAddRow.dataset.tableAddRow);
      if (tb1) {
        const cols = tb1.rows[0] ? tb1.rows[0].length : 2;
        tb1.rows.push(new Array(cols).fill(""));
        renderBlocksOnly();
        scheduleSave();
      }
      return;
    }
    const tAddCol = e.target.closest("[data-table-add-col]");
    if (tAddCol) {
      const tb2 = findBlockById(page.blocks, tAddCol.dataset.tableAddCol);
      if (tb2) {
        tb2.rows.forEach((r) => r.push(""));
        renderBlocksOnly();
        scheduleSave();
      }
      return;
    }
    const tDelRow = e.target.closest("[data-table-del-row]");
    if (tDelRow) {
      const tb3 = findBlockById(page.blocks, tDelRow.dataset.tableDelRow);
      if (tb3 && tb3.rows.length > 1) {
        tb3.rows.pop();
        renderBlocksOnly();
        scheduleSave();
      }
      return;
    }
    const tDelCol = e.target.closest("[data-table-del-col]");
    if (tDelCol) {
      const tb4 = findBlockById(page.blocks, tDelCol.dataset.tableDelCol);
      if (tb4 && tb4.rows[0] && tb4.rows[0].length > 1) {
        tb4.rows.forEach((r) => r.pop());
        renderBlocksOnly();
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
        // Keep inline formatting (bold, italic, links) so it survives a
        // re-render such as adding a row or a column.
        b.rows[parseInt(t.dataset.r, 10)][parseInt(t.dataset.c, 10)] = sanitizeHtmlFragment(t.innerHTML);
        scheduleSave();
      }
      return;
    }
    if (t.matches("[data-image-caption]")) {
      updateBlockField(page, t.dataset.imageCaption, { caption: t.textContent });
      scheduleSave();
      return;
    }

    if (t.matches("[data-tl-field]")) {
      const itemEl = t.closest("[data-tl-item]");
      const wrapEl = t.closest("[data-tl-block]");
      const tlb = wrapEl ? findBlockById(page.blocks, wrapEl.dataset.tlBlock) : null;
      const item = tlb && Array.isArray(tlb.items) && itemEl
        ? tlb.items.find((x) => x.id === itemEl.dataset.tlItem)
        : null;
      if (item) {
        // Inline formatting is kept so bold survives adding another entry.
        item[t.dataset.tlField] = sanitizeHtmlFragment(t.innerHTML);
        scheduleSave();
      }
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
    const isRich =
      (e.target.classList && e.target.classList.contains("rt")) ||
      (e.target.dataset && e.target.dataset.tableCell);
    if (isRich) removeToolbar();
  });

  mainInner.addEventListener("mouseup", (e) => {
    const cell = e.target.closest("[data-table-cell]");
    if (cell) {
      setTimeout(() => maybeShowToolbar(cell, cell.dataset.tableCell), 0);
      return;
    }
    const rt = e.target.closest(".rt");
    if (rt) {
      const row = rt.closest(".block-row");
      const blockId = row ? row.dataset.blockId : null;
      setTimeout(() => maybeShowToolbar(rt, blockId), 0);
    }
  });

  mainInner.addEventListener("keyup", (e) => {
    if (["Shift", "Control", "Alt", "Meta"].indexOf(e.key) > -1) return;
    const cell = e.target.closest ? e.target.closest("[data-table-cell]") : null;
    if (cell) {
      if (window.getSelection().toString().length > 0) maybeShowToolbar(cell, cell.dataset.tableCell);
      else removeToolbar();
      return;
    }
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
    const tlField = t.closest ? t.closest("[data-tl-field]") : null;
    if (tlField) {
      // Enter moves date -> what happened -> detail, then starts a new entry.
      // Shift+Enter is a line break inside the field, as everywhere else.
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const itemEl = tlField.closest("[data-tl-item]");
        const which = tlField.dataset.tlField;
        if (which === "date") focusTimelineField(itemEl.dataset.tlItem, "title");
        else if (which === "title") focusTimelineField(itemEl.dataset.tlItem, "detail");
        else if (page) {
          const wrapEl = tlField.closest("[data-tl-block]");
          const tlb = wrapEl ? findBlockById(page.blocks, wrapEl.dataset.tlBlock) : null;
          if (tlb && Array.isArray(tlb.items)) {
            const idx = tlb.items.findIndex((x) => x.id === itemEl.dataset.tlItem);
            const item = newTimelineItem();
            tlb.items.splice(idx + 1, 0, item);
            renderBlocksOnly();
            focusTimelineField(item.id, "date");
            scheduleSave();
          }
        }
      }
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
        renderBlocksOnly();
        focusBlock(nb.id, false);
        scheduleSave();
        return;
      }

      // Enter in callout header: move into / create children
      if (blockType === "callout" && t.closest(".b-callout-header")) {
        e.preventDefault();
        updateBlockField(page, blockId, { content: beforeHtml });
        if (!Array.isArray(block.children)) block.children = [];
        if (block.children.length > 0) {
          renderBlocksOnly();
          focusBlock(block.children[0].id, false);
        } else {
          const nbc = newBlock("paragraph");
          nbc.content = afterHtml;
          block.children.push(nbc);
          renderBlocksOnly();
          focusBlock(nbc.id, false);
        }
        scheduleSave();
        return;
      }

      updateBlockField(page, blockId, { content: beforeHtml });
      const continueType = blockType === "bulleted" || blockType === "numbered" || blockType === "todo" ? blockType : "paragraph";
      if (continueType !== "paragraph" && beforeHtml === "" && afterHtml === "") {
        convertBlockType(page, blockId, "paragraph");
        renderBlocksOnly();
        focusBlock(blockId, false);
        scheduleSave();
        return;
      }
      const nb2 = newBlock(continueType);
      nb2.content = afterHtml;
      insertBlockAfter(page, blockId, nb2);
      renderBlocksOnly();
      focusBlock(nb2.id, false);
      scheduleSave();
      return;
    }

    if (e.key === "Backspace") {
      if (!isCursorAtStart(t)) return;
      const c = findContainer(page.blocks, blockId);
      if (!c) return;
      const isEmpty = blockType === "toggle" ? (block.summary || "") === "" : (block.content || "") === "";

      // Backspace at start of first block in a callout: escape to the callout header.
      if (c && c.idx === 0) {
        let _calloutPar = null;
        for (let _bi = 0; _bi < page.blocks.length; _bi++) {
          const _bl = page.blocks[_bi];
          if (_bl.type === "callout" && Array.isArray(_bl.children) && findContainer(_bl.children, blockId)) {
            _calloutPar = _bl; break;
          }
        }
        if (_calloutPar) {
          e.preventDefault();
          const _hdr = document.querySelector(".block-row[data-block-id='" + _calloutPar.id + "'] .b-callout-header .rt");
          if (_hdr) { _hdr.focus(); const _r = document.createRange(); _r.selectNodeContents(_hdr); _r.collapse(false); const _sel = window.getSelection(); _sel.removeAllRanges(); _sel.addRange(_r); }
          return;
        }
      }

      if (blockType !== "paragraph" && isEmpty) {
        e.preventDefault();
        convertBlockType(page, blockId, "paragraph");
        renderBlocksOnly();
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
        renderBlocksOnly();
        focusBlockAtOffset(prevBlock.id, prevLen);
        scheduleSave();
        return;
      }
      if (isEmpty) {
        e.preventDefault();
        c.arr.splice(c.idx, 1);
        if (page.blocks.length === 0) page.blocks.push(newBlock("paragraph"));
        renderBlocksOnly();
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
    renderBlocksOnly();
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

/* ------------------------------------------------------------------ *
 * Plan view
 * ------------------------------------------------------------------ */

/* Reads the minute boxes currently on screen for the chosen mode. */
function readSetupCard(mode) {
  const values = {};
  document.querySelectorAll("[data-plan-min]").forEach((input) => {
    values[input.dataset.planMin] = input.value;
  });
  const auto = document.getElementById("plan-auto-tests");
  const narrow = document.getElementById("plan-narrow");
  return {
    mode: mode,
    minutesByWeekday: minutesForMode(mode, values),
    autoScheduleTests: auto ? !!auto.checked : true,
    narrowScope: narrow ? !!narrow.checked : false,
    maxSubjectsPerDay: 3
  };
}

/** Starts whatever a plan task actually is. */
function runPlanTask(task) {
  if (!task) return;
  // Start the clock: markTaskDone compares this against the estimate.
  noteTaskStart(task);
  if (task.kind === "quiz") {
    openQuizSetup(task.pageId);
    return;
  }
  if (task.kind === "practise") {
    openPractiseSetup(task.pageId);
    return;
  }
  if (task.kind === "test") {
    openTestSetup(task.pageId);
    return;
  }
  if (task.kind === "read") {
    navigateTo(task.pageId);
    return;
  }
  // Flashcard work: due cards only for "due", the whole page otherwise.
  const scope = { type: "page", pageId: task.pageId };
  const mode = task.kind === "due" ? "due" : "everything";
  startFlashcards(scope, mode, { id: task.id, date: task.date, minutes: task.minutes });
}

/** The next thing still outstanding today, used by "Next task". */
function nextOutstandingTask() {
  const p = ensurePlan();
  const key = p.generatedFor || null;
  const tasks = todayTasks();
  const today = tasks.filter((t) => !isTaskDone(t.date, t.id) && !isTaskSkipped(t.date, t.id));
  void key;
  return today[0] || null;
}

setFlashcardsNextTask(() => {
  const next = nextOutstandingTask();
  if (next) runPlanTask(next);
});

function handlePlanClick(e) {
  const modeBtn = e.target.closest("[data-plan-mode]");
  if (modeBtn) {
    // Switching mode keeps whatever minutes are already on screen.
    const st = planSettings();
    st.mode = modeBtn.dataset.planMode;
    renderMain();
    return true;
  }

  const tick = e.target.closest("[data-plan-tick]");
  if (tick) {
    toggleTaskDone(tick.dataset.date, tick.dataset.planTick, Number(tick.dataset.minutes) || 0);
    renderMain();
    return true;
  }

  const skip = e.target.closest("[data-plan-skip]");
  if (skip) {
    const id = skip.dataset.planSkip;
    // Something pulled forward goes back where it came from instead.
    if (!undoPull(id)) skipTask(skip.dataset.date, id);
    renderMain();
    return true;
  }

  const expand = e.target.closest("[data-plan-expand]");
  if (expand) {
    expandPlanTask(expand.dataset.planExpand);
    renderMain();
    return true;
  }

  const go = e.target.closest("[data-plan-task]");
  if (go) {
    runPlanTask({
      id: go.dataset.planTask,
      kind: go.dataset.kind,
      pageId: go.dataset.pageId,
      date: go.dataset.date,
      minutes: Number(go.dataset.minutes) || 0
    });
    return true;
  }

  const open = e.target.closest("[data-plan-open]");
  if (open) {
    navigateTo(open.dataset.planOpen);
    return true;
  }

  const day = e.target.closest("[data-plan-day]");
  if (day) {
    togglePlanTimeline();
    renderMain();
    return true;
  }

  const act = e.target.closest("[data-plan-act]");
  if (!act) return false;
  const which = act.dataset.planAct;

  if (which === "save-setup") {
    const st = planSettings();
    saveSetup(readSetupCard(st.mode || "split"));
    togglePlanSettings(false);
    renderMain();
    return true;
  }
  if (which === "progress") {
    togglePlanProgress();
    renderMain();
    return true;
  }
  if (which === "showall") {
    togglePlanList();
    renderMain();
    return true;
  }
  if (which === "digest-dismiss") {
    dismissDigest();
    renderMain();
    return true;
  }
  if (which === "add-time") {
    addMinutesPerDay(Number(act.dataset.minutes) || 15);
    renderMain();
    return true;
  }
  if (which === "narrow") {
    setNarrowScope(act.dataset.on === "1");
    renderMain();
    return true;
  }
  if (which === "settings") {
    togglePlanSettings(true);
    renderMain();
    return true;
  }
  if (which === "settings-cancel") {
    togglePlanSettings(false);
    renderMain();
    return true;
  }
  if (which === "replan") {
    regeneratePlan(true);
    renderMain();
    return true;
  }
  if (which === "timeline") {
    togglePlanTimeline();
    renderMain();
    return true;
  }
  if (which === "pull") {
    pullForward();
    renderMain();
    return true;
  }
  if (which === "revise") {
    startFlashcards({ type: "page", pageId: act.dataset.pageId }, "everything");
    return true;
  }
  if (which === "quiz") {
    openQuizSetup(act.dataset.pageId);
    return true;
  }
  if (act.dataset.pageId) {
    navigateTo(act.dataset.pageId);
    return true;
  }
  return false;
}
