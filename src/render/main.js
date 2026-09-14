// Main panel rendering: breadcrumbs, header, exam panel, blocks.
// Subpages are not listed separately — they appear inline as page blocks.
import { store, getPage } from "../state.js";
import { escapeHtml, formatDateHuman, countdownInfo } from "../utils.js";
import { renderBlocksList } from "./blocks.js";
import { renderCalendarView } from "./calendar.js";
import { renderPlanView } from "./plan.js";
import { renderFlashcardsView } from "./flashcards.js";
import { renderToc } from "./toc.js";
import { iconImg, ui } from "../icons.js";
import { cardsForPage, isDue } from "../srs.js";
import { testEligibility } from "../exam/session.js";
import { quizEligibility } from "../quiz/session.js";
import { practiseEligibility } from "../practise/session.js";
import { renderWorkSection } from "./work.js";
import { renderFeedbackSection } from "./insights.js";

/*
 * Painting the main column.
 *
 * The scroll position is only thrown away when the view genuinely changes
 * (a different page, or switching to Plan). Re-rendering the same view -
 * ticking a task, opening a section, checking a to-do, marking work - keeps
 * you exactly where you were. Every button in the app re-renders through
 * here, so this is the single place that behaviour lives.
 */
let paintedKey = "";

function viewKey() {
  if (store.currentView === "page") return "page:" + store.state.activePageId;
  return String(store.currentView || "");
}

function paint(root, html) {
  const main = document.getElementById("main");
  const key = viewKey();
  const sameView = key === paintedKey;
  // On a phone the window scrolls; on a desktop the #main column does.
  const keepMain = sameView && main ? main.scrollTop : 0;
  const keepWindow = sameView ? window.scrollY || 0 : 0;
  root.innerHTML = html;
  paintedKey = key;
  if (main) main.scrollTop = keepMain;
  if (keepWindow) window.scrollTo(0, keepWindow);
}

/** Forces the next paint to start at the top, for a deliberate jump. */
export function resetMainScroll() {
  paintedKey = "";
}

export function renderMain() {
  const root = document.getElementById("main-inner");

  if (store.currentView === "plan") {
    paint(root, renderPlanView());
    renderToc();
    return;
  }

  // Flashcards runs inside the main column on a desktop, so the sidebar and
  // the rest of the workspace stay exactly where they were.
  if (store.currentView === "flashcards") {
    paint(root, renderFlashcardsView());
    renderToc();
    return;
  }

  if (store.currentView === "calendar") {
    paint(root, renderCalendarView());
    renderToc();
    return;
  }

  const page = getPage(store.state.activePageId);
  if (!page) {
    paint(root, renderEmptyState());
    renderToc();
    return;
  }

  let html = renderBreadcrumbs(page);
  html += renderPageHeader(page);
  if (page.type === "subject") html += renderExamPanel(page);
  html += renderPageActions(page);
  html += '<div class="block-list" id="block-list" data-page-id="' + page.id + '">' + renderBlocksList(page.blocks) + "</div>";
  // Invisible click target: clicking the space under the last block starts a
  // new paragraph, without adding another visible "add a block" row.
  html += '<div class="page-tail" id="page-tail"></div>';
  // Everything already sat on this page, plus any feedback still outstanding.
  html += renderWorkSection(page.id, { title: "Marked work on this page" });
  html += renderFeedbackSection({ pageId: page.id, title: "Exam feedback for this page", limit: 8 });
  paint(root, html);
  renderToc();
  wireCopyPageButton(page);
}

/*
 * Re-renders only the block list. Typing-speed edits (Enter, Backspace, adding
 * or moving a block) use this instead of renderMain so the header, exam panel
 * and quiz history are not rebuilt - and, importantly, so the page does not
 * jump back to the top on every keystroke.
 */
export function renderBlocksOnly() {
  const page = getPage(store.state.activePageId);
  const list = document.getElementById("block-list");
  if (!page || store.currentView !== "page" || !list || list.dataset.pageId !== page.id) {
    renderMain();
    return;
  }
  list.innerHTML = renderBlocksList(page.blocks);
  renderToc();
}

export function renderEmptyState() {
  return (
    '<div class="empty-state">' +
    '<div class="big-icon">' +
    iconImg("notebook", 56) +
    "</div>" +
    "<h2>Welcome to ReviseIQ</h2>" +
    "<p>Create your first subject to start building revision notes, tracking exam dates, and organising topics.</p>" +
    '<button id="empty-new-subject">' + ui("plus", 14, 2.4) + " New subject</button>" +
    "</div>"
  );
}

/*
 * Actions above the notes: revise the flashcards in this section, and - for
 * AQA History pages only - sit a timed mock exam written from these notes.
 */
export function renderPageActions(page) {
  const revise = renderReviseButton(page);
  const quiz = renderQuizButton(page);
  const practise = renderPractiseButton(page);
  const test = renderTestButton(page);
  if (!revise && !quiz && !practise && !test) return "";
  return '<div class="page-actions">' + revise + quiz + practise + test + "</div>";
}

/*
 * Quiz me works on any page with enough written on it: a hard multiple-choice
 * quiz on these notes, marked the moment it is finished.
 */
function renderQuizButton(page) {
  const el = quizEligibility(page.id);
  if (!el) return "";
  if (!el.enough) {
    return (
      '<button class="btn-quiz is-disabled" disabled title="Add more notes first \u2014 ' +
      el.words +
      ' words so far">' +
      ui("quiz", 15) +
      "<span>Quiz me</span></button>"
    );
  }
  return (
    '<button class="btn-quiz" id="quiz-me-btn" data-page-id="' +
    page.id +
    '" title="Answer a hard multiple-choice quiz written from these notes">' +
    ui("quiz", 15) +
    "<span>Quiz me</span>" +
    '<span class="quiz-badge">MCQ</span>' +
    "</button>"
  );
}

/*
 * Practise sits between the two: ten to twenty-five minutes of written work.
 * It runs on any page with enough notes. Where the real structure of the exam
 * is known it finishes with genuine exam questions; where it is not, the
 * knowledge stage simply runs longer and no exam questions are invented.
 */
function renderPractiseButton(page) {
  const el = practiseEligibility(page.id);
  if (!el) return "";
  if (!el.enough) {
    return (
      '<button class="btn-practise is-disabled" disabled title="Add more notes first \u2014 ' +
      el.words +
      ' words so far">' +
      ui("marksheet", 15) +
      "<span>Practise</span></button>"
    );
  }
  return (
    '<button class="btn-practise" id="practise-me-btn" data-page-id="' +
    page.id +
    '" title="' +
    (el.exam
      ? "Written questions, then real exam questions \u2014 up to 25 minutes"
      : "Hard written questions on these notes \u2014 up to 25 minutes") +
    '">' +
    ui("marksheet", 15) +
    "<span>Practise</span>" +
    '<span class="practise-badge">' +
    (el.exam ? "Written + exam" : "Written") +
    "</span>" +
    "</button>"
  );
}

/*
 * The Test me button appears only where the prompt actually exists: a page
 * whose subject is History with AQA as the exam board. Everywhere else there
 * is no button at all, rather than a button that produces a bad paper.
 */
function renderTestButton(page) {
  const el = testEligibility(page.id);
  if (!el) return "";
  if (!el.enough) {
    return (
      '<button class="btn-test is-disabled" disabled title="Add more notes first \u2014 ' +
      el.words +
      ' words so far">' +
      ui("target", 15) +
      "<span>Test me</span></button>"
    );
  }
  return (
    '<button class="btn-test" id="test-me-btn" data-page-id="' +
    page.id +
    '" title="Sit a timed AQA-style mock written from these notes">' +
    ui("target", 15) +
    "<span>Test me</span>" +
    '<span class="test-badge">AQA</span>' +
    "</button>"
  );
}

function renderReviseButton(page) {
  const cards = cardsForPage(page.id);
  if (!cards.length) return "";
  const due = cards.filter((c) => isDue(c.id)).length;
  const quiet = due === 0;
  return (
    '<button class="btn-revise' +
    (quiet ? " is-quiet" : "") +
    '" id="revise-page-btn" data-page-id="' +
    page.id +
    '" title="Test yourself on the flashcards in this section">' +
    ui("flashcard", 15) +
    (quiet ? "<span>Revise" : "<span>Revise now") +
    "</span>" +
    '<span class="revise-badge">' +
    (due > 0 ? due + " due" : cards.length + " card" + (cards.length === 1 ? "" : "s")) +
    "</span>" +
    "</button>"
  );
}

export function renderBreadcrumbs(page) {
  const chain = [];
  let cur = page;
  while (cur && cur.parentId) {
    cur = getPage(cur.parentId);
    if (cur) chain.unshift(cur);
  }
  let html = '<div class="breadcrumbs">';
  chain.forEach((p) => {
    html +=
      '<span class="crumb" data-nav="' +
      p.id +
      '">' +
      iconImg(p.icon, 14) +
      '<span class="crumb-text">' +
      escapeHtml(p.title || "Untitled") +
      '</span></span><span class="crumb-sep">/</span>';
  });
  html +=
    '<span class="crumb current">' +
    iconImg(page.icon, 14) +
    '<span class="crumb-text">' +
    escapeHtml(page.title || "Untitled") +
    "</span></span></div>";
  return html;
}

export function renderPageHeader(page) {
  return (
    '<div class="page-header">' +
    '<button class="page-icon-btn" id="page-icon-btn" title="Change icon" data-page-id="' +
    page.id +
    '">' +
    iconImg(page.icon, 46) +
    "</button>" +
    '<div class="page-title" id="page-title" contenteditable="true" data-placeholder="Untitled" data-page-id="' +
    page.id +
    '">' +
    escapeHtml(page.title) +
    "</div>" +
    '<button class="copy-page-btn" id="copy-page-notes-btn" type="button" data-page-id="' +
    page.id +
    '" title="Copy this page’s notes for pasting into Google Docs" aria-label="Copy all notes">' +
    ui("copy", 16) +
    "<span>Copy</span></button>" +
    '<button class="page-menu-btn" data-page-menu="' +
    page.id +
    '" title="Page options">' +
    ui("dots", 18) +
    "</button></div>"
  );
}

export function renderExamPanel(page) {
  const boards = ["AQA", "Edexcel", "OCR", "WJEC / Eduqas", "CCEA", "Other"];
  let html = '<div class="meta-panel">';
  html += '<div class="meta-row"><div class="meta-label">Exam board</div><select class="board-select" id="board-select">';
  html += '<option value="" ' + (!page.examBoard ? "selected" : "") + ">Not set</option>";
  boards.forEach((b) => {
    html += '<option value="' + escapeHtml(b) + '" ' + (page.examBoard === b ? "selected" : "") + ">" + b + "</option>";
  });
  html += "</select>";
  if (page.examBoard === "Other") {
    html +=
      '<input type="text" class="board-other" id="board-other" placeholder="Enter exam board" value="' +
      escapeHtml(page.examBoardOther || "") +
      '" />';
  }
  html += "</div>";

  html +=
    '<div class="meta-row" style="align-items:flex-start;"><div class="meta-label" style="padding-top:5px;">Exam dates</div><div style="flex:1;"><div class="exam-chips" id="exam-chips">';
  const sorted = page.examDates.slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  sorted.forEach((ex) => {
    const ci = countdownInfo(ex.date);
    html +=
      '<div class="exam-chip"><span class="name">' +
      escapeHtml(ex.name) +
      '</span><span class="date">' +
      formatDateHuman(ex.date) +
      '</span><span class="badge ' +
      ci.cls +
      '">' +
      ci.label +
      '</span><button class="chip-remove" data-remove-exam="' +
      ex.id +
      '" title="Remove">' +
      ui("close", 11, 2.6) +
      "</button></div>";
  });
  html += '<button class="add-exam-btn" id="add-exam-btn">' + ui("plus", 12, 2.4) + " Add exam date</button>";
  html += "</div></div></div></div>";
  return html;
}

/*
 * Build a paste-friendly HTML representation of the current page. This does
 * not copy editor controls or internal data attributes, and uses semantic
 * elements so Google Docs recognises headings, lists, quotes and tables.
 */
function pageNotesToClipboardHtml(page) {
  const list = document.getElementById("block-list");
  if (!list) return "<h1>" + escapeHtml(page.title || "Untitled") + "</h1>";

  const topRows = Array.prototype.slice.call(list.children).filter((el) => el.classList.contains("block-row"));
  let html = '<div style="font-family:Arial,Helvetica,sans-serif;line-height:1.45;">';
  html += '<h1 style="font-size:24px;margin:0 0 16px 0;">' + escapeHtml(page.title || "Untitled") + "</h1>";
  html += exportRows(topRows);
  html += "</div>";
  return html;
}

function exportRows(rows) {
  let html = "";
  let i = 0;
  while (i < rows.length) {
    const row = rows[i];
    const type = row.dataset.blockType || "paragraph";

    if (type === "bulleted" || type === "numbered") {
      const tag = type === "bulleted" ? "ul" : "ol";
      html += "<" + tag + " style=\"margin:8px 0 8px 24px;padding-left:20px;\">";
      while (i < rows.length && (rows[i].dataset.blockType || "") === type) {
        const rt = rows[i].querySelector(".rt");
        html += "<li>" + (rt ? rt.innerHTML : "") + "</li>";
        i++;
      }
      html += "</" + tag + ">";
      continue;
    }

    html += exportRow(row);
    i++;
  }
  return html;
}

function exportRow(row) {
  const type = row.dataset.blockType || "paragraph";
  const content = (el) => (el ? el.innerHTML : "");
  const rt = row.querySelector(":scope > .block-content > .rt") || row.querySelector(":scope > .block-content .rt");

  if (type === "paragraph") return '<p style="margin:8px 0;">' + content(rt) + "</p>";
  if (type === "heading1") return '<h2 style="margin:18px 0 8px 0;">' + content(rt) + "</h2>";
  if (type === "heading2") return '<h3 style="margin:16px 0 7px 0;">' + content(rt) + "</h3>";
  if (type === "heading3") return '<h4 style="margin:14px 0 6px 0;">' + content(rt) + "</h4>";
  if (type === "quote") return '<blockquote style="margin:10px 0;padding-left:14px;border-left:3px solid #999;">' + content(rt) + "</blockquote>";
  if (type === "todo") {
    const checked = row.querySelector(".todo-check.checked") ? "☑" : "☐";
    return '<p style="margin:8px 0;">' + checked + " " + content(row.querySelector(".todo-text")) + "</p>";
  }
  if (type === "divider") return '<hr style="margin:18px 0;border:0;border-top:1px solid #aaa;" />';
  if (type === "code") {
    const area = row.querySelector(".code-area");
    const lang = row.querySelector("[data-code-lang]");
    const label = lang && lang.value ? '<div style="font-size:11px;font-weight:600;margin:10px 0 3px 0;">' + escapeHtml(lang.value) + "</div>" : "";
    return label + '<pre style="margin:6px 0 12px 0;padding:10px;background:#f3f3f3;white-space:pre-wrap;font-family:monospace;">' + escapeHtml(area ? area.value : "") + "</pre>";
  }
  if (type === "table") {
    const source = row.querySelector("table");
    if (!source) return "";
    const table = source.cloneNode(true);
    table.removeAttribute("class");
    table.querySelectorAll("td,th").forEach((cell) => {
      cell.removeAttribute("contenteditable");
      cell.removeAttribute("data-table-cell");
      cell.removeAttribute("data-r");
      cell.removeAttribute("data-c");
      cell.setAttribute("style", "border:1px solid #999;padding:6px;vertical-align:top;");
    });
    table.setAttribute("style", "border-collapse:collapse;width:100%;margin:10px 0;");
    return table.outerHTML;
  }
  if (type === "image") {
    const image = row.querySelector("img");
    if (!image) return "";
    const caption = row.querySelector(".b-image-caption");
    return '<div style="margin:10px 0;">' + image.outerHTML + (caption && caption.textContent.trim() ? '<div style="font-size:12px;font-style:italic;">' + escapeHtml(caption.textContent.trim()) + "</div>" : "") + "</div>";
  }
  if (type === "video") return '<p style="margin:8px 0;">YouTube video</p>';
  if (type === "page") {
    const title = row.querySelector(".b-page-row .title");
    return '<p style="margin:8px 0;"><strong>' + escapeHtml(title ? title.textContent : "Subpage") + "</strong></p>";
  }
  if (type === "callout") {
    const wrap = row.querySelector(":scope > .block-content .b-callout-wrap");
    if (!wrap) return "";
    const title = wrap.querySelector(":scope > .b-callout-header .rt");
    const kids = wrap.querySelector(":scope > .callout-children");
    return '<div style="margin:10px 0;padding:10px 12px;border-left:3px solid #888;background:#f7f7f7;">' +
      '<p style="margin:0 0 8px 0;"><strong>' + content(title) + "</strong></p>" +
      (kids ? exportRows(Array.prototype.slice.call(kids.children).filter((el) => el.classList.contains("block-row"))) : "") +
      "</div>";
  }
  if (type === "toggle") {
    const summary = row.querySelector(":scope > .block-content > .toggle-row .rt");
    const children = row.querySelector(":scope > .block-content > .toggle-children");
    return '<h3 style="margin:14px 0 6px 0;">' + content(summary) + "</h3>" +
      (children ? exportRows(Array.prototype.slice.call(children.children).filter((el) => el.classList.contains("block-row"))) : "");
  }
  if (type === "definition") {
    const term = row.querySelector(".def-term");
    const meaning = row.querySelector(".def-meaning");
    const example = row.querySelector(".def-example");
    return '<p style="margin:10px 0 3px 0;"><strong>' + content(term) + "</strong></p>" +
      (meaning ? '<p style="margin:3px 0;">' + meaning.innerHTML + "</p>" : "") +
      (example && example.textContent.trim() ? '<p style="margin:3px 0;font-style:italic;">Example: ' + example.innerHTML + "</p>" : "");
  }
  if (type === "comparison") {
    const labels = Array.prototype.slice.call(row.querySelectorAll(":scope .cmp-label"));
    const cells = Array.prototype.slice.call(row.querySelectorAll(":scope .cmp-row"));
    let out = '<table style="border-collapse:collapse;width:100%;margin:10px 0;"><tbody>';
    if (labels.length) out += "<tr>" + labels.map((el) => '<th style="border:1px solid #999;padding:6px;text-align:left;">' + el.innerHTML + "</th>").join("") + "</tr>";
    cells.forEach((r) => {
      const cs = r.querySelectorAll(":scope .cmp-cell");
      out += "<tr>" + Array.prototype.map.call(cs, (el) => '<td style="border:1px solid #999;padding:6px;vertical-align:top;">' + el.innerHTML + "</td>").join("") + "</tr>";
    });
    return out + "</tbody></table>";
  }
  if (type === "process") {
    const steps = Array.prototype.slice.call(row.querySelectorAll(":scope .proc-step"));
    let out = "<ol style=\"margin:8px 0 8px 24px;padding-left:20px;\">";
    steps.forEach((step) => {
      const text = step.querySelector(".proc-text");
      const why = step.querySelector(".proc-why");
      out += "<li>" + (text ? text.innerHTML : "") + (why && why.textContent.trim() ? " — " + why.innerHTML : "") + "</li>";
    });
    return out + "</ol>";
  }
  if (type === "timeline") {
    const items = Array.prototype.slice.call(row.querySelectorAll(":scope .tl-item"));
    let out = "";
    items.forEach((item) => {
      const date = item.querySelector(".tl-date");
      const title = item.querySelector(".tl-title");
      const detail = item.querySelector(".tl-detail");
      out += '<p style="margin:10px 0 3px 0;"><strong>' + (date ? date.innerHTML : "") + " — " + (title ? title.innerHTML : "") + "</strong></p>";
      if (detail && detail.textContent.trim()) out += '<p style="margin:3px 0 10px 0;">' + detail.innerHTML + "</p>";
    });
    return out;
  }
  if (type === "source") {
    const quote = row.querySelector(".src-quote");
    const attribution = row.querySelector(".src-attr");
    const date = row.querySelector(".src-date");
    const comment = row.querySelector(".src-comment");
    return '<blockquote style="margin:10px 0;padding-left:14px;border-left:3px solid #999;">' + (quote ? quote.innerHTML : "") +
      (attribution || date ? '<div style="margin-top:5px;font-size:12px;"><strong>' + (attribution ? attribution.innerHTML : "") + (date && date.textContent.trim() ? ", " + date.innerHTML : "") + "</strong></div>" : "") +
      (comment && comment.textContent.trim() ? '<div style="margin-top:6px;">' + comment.innerHTML + "</div>" : "") +
      "</blockquote>";
  }
  if (type === "statistic") {
    const value = row.querySelector(".stat-value");
    const label = row.querySelector(".stat-label");
    const context = row.querySelector(".stat-context");
    return '<p style="margin:10px 0 3px 0;font-size:18px;"><strong>' + (value ? value.innerHTML : "") + "</strong></p>" +
      (label ? '<p style="margin:3px 0;"><strong>' + label.innerHTML + "</strong></p>" : "") +
      (context && context.textContent.trim() ? '<p style="margin:3px 0 10px 0;">' + context.innerHTML + "</p>" : "");
  }
  return "";
}

function clipboardPlainTextFromHtml(html) {
  const temp = document.createElement("div");
  temp.style.position = "fixed";
  temp.style.left = "-100000px";
  temp.style.top = "0";
  temp.innerHTML = html;
  document.body.appendChild(temp);
  const text = temp.innerText || temp.textContent || "";
  temp.remove();
  return text.replace(/\u00a0/g, " ").replace(/[ \t]+\n/g, "\n").trim();
}

async function copyPageNotes(page, button) {
  const html = pageNotesToClipboardHtml(page);
  const text = clipboardPlainTextFromHtml(html);

  try {
    if (navigator.clipboard && window.ClipboardItem) {
      const item = new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([text], { type: "text/plain" })
      });
      await navigator.clipboard.write([item]);
    } else {
      const holder = document.createElement("div");
      holder.contentEditable = "true";
      holder.style.position = "fixed";
      holder.style.left = "-100000px";
      holder.style.top = "0";
      holder.innerHTML = html;
      document.body.appendChild(holder);
      const range = document.createRange();
      range.selectNodeContents(holder);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      const ok = document.execCommand("copy");
      selection.removeAllRanges();
      holder.remove();
      if (!ok) throw new Error("Copy command failed");
    }

    const original = button.innerHTML;
    button.innerHTML = ui("check", 16, 2.8) + "<span>Copied</span>";
    button.classList.add("is-copied");
    button.setAttribute("aria-label", "Notes copied");
    setTimeout(() => {
      if (!document.body.contains(button)) return;
      button.innerHTML = original;
      button.classList.remove("is-copied");
      button.setAttribute("aria-label", "Copy all notes");
    }, 1800);
  } catch (err) {
    button.classList.add("is-copy-error");
    button.title = "Couldn’t copy the notes. Try again.";
    setTimeout(() => {
      if (document.body.contains(button)) button.classList.remove("is-copy-error");
    }, 1800);
  }
}

function wireCopyPageButton(page) {
  const button = document.getElementById("copy-page-notes-btn");
  if (!button || button.dataset.wired === "true") return;
  button.dataset.wired = "true";
  button.addEventListener("click", () => copyPageNotes(page, button));
}
