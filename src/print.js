/*
 * Revision-notes export.
 *
 * Everything a student writes here is eventually revised on paper, so a page
 * (and optionally everything under it) can be rendered as a clean printable
 * document and handed to the browser's print dialog, which is also how you
 * save a PDF. The app's own chrome is hidden and the notes are re-rendered
 * from state rather than screenshotted, so the output is typeset for A4
 * rather than being a picture of a web page.
 */
import { store, getPage, getChildren } from "./state.js";
import { escapeHtml, sanitizeHtmlFragment, formatDateHuman } from "./utils.js";
import { iconImg } from "./icons.js";
import { cardsForPage, allCards, dueCards, todayKey } from "./srs.js";
import { tasksFor, weekOverview } from "./plan/store.js";
import { openInsights } from "./exam/insights.js";

const ROOT_ID = "print-root";

function printRoot() {
  let el = document.getElementById(ROOT_ID);
  if (!el) {
    el = document.createElement("div");
    el.id = ROOT_ID;
    document.body.appendChild(el);
  }
  return el;
}

function rich(html) {
  // Notes are stored as sanitised inline HTML; keep bold, italics and links.
  return sanitizeHtmlFragment(String(html || ""));
}

function textOf(html) {
  const d = document.createElement("div");
  d.innerHTML = String(html || "");
  return (d.textContent || "").trim();
}

function blocksHtml(blocks, opts) {
  const list = Array.isArray(blocks) ? blocks : [];
  let out = "";
  let i = 0;

  while (i < list.length) {
    const b = list[i];
    if (!b || typeof b !== "object") {
      i++;
      continue;
    }

    // Consecutive list items are gathered so the PDF gets real <ul>/<ol>.
    if (b.type === "bulleted" || b.type === "numbered") {
      const tag = b.type === "bulleted" ? "ul" : "ol";
      let items = "";
      while (i < list.length && list[i] && list[i].type === b.type) {
        items += "<li>" + rich(list[i].content) + "</li>";
        i++;
      }
      out += "<" + tag + ' class="pr-list">' + items + "</" + tag + ">";
      continue;
    }

    out += oneBlock(b, opts);
    i++;
  }
  return out;
}

function oneBlock(b, opts) {
  switch (b.type) {
    case "heading1":
      return '<h2 class="pr-h1">' + rich(b.content) + "</h2>";
    case "heading2":
      return '<h3 class="pr-h2">' + rich(b.content) + "</h3>";
    case "heading3":
      return '<h4 class="pr-h3">' + rich(b.content) + "</h4>";
    case "paragraph":
      return textOf(b.content) ? '<p class="pr-p">' + rich(b.content) + "</p>" : "";
    case "quote":
      return '<blockquote class="pr-quote">' + rich(b.content) + "</blockquote>";
    case "todo":
      return (
        '<p class="pr-todo"><span class="pr-box">' +
        (b.checked ? "&#10003;" : "&nbsp;") +
        "</span>" +
        rich(b.content) +
        "</p>"
      );
    case "divider":
      return '<hr class="pr-hr" />';
    case "code":
      return '<pre class="pr-code">' + escapeHtml(b.content || "") + "</pre>";
    case "callout":
      return (
        '<div class="pr-callout"><div class="pr-callout-body">' +
        (textOf(b.content) ? '<p class="pr-p">' + rich(b.content) + "</p>" : "") +
        blocksHtml(b.children || [], opts) +
        "</div></div>"
      );
    case "toggle":
      return (
        '<div class="pr-toggle"><div class="pr-toggle-title">' + rich(b.summary) + "</div>" +
        blocksHtml(b.children || [], opts) +
        "</div>"
      );
    case "definition":
      // A key term is a flashcard, so the meaning can be left blank and the
      // printout doubles as a self-test sheet.
      return (
        '<div class="pr-card">' +
        '<div class="pr-card-q">' + rich(b.term) + "</div>" +
        (opts.answers
          ? '<div class="pr-card-a"><p class="pr-p">' + rich(b.definition) + "</p>" +
            (textOf(b.example) ? '<p class="pr-p"><em>' + rich(b.example) + "</em></p>" : "") +
            "</div>"
          : '<div class="pr-card-blank"></div>') +
        "</div>"
      );
    case "comparison":
      return comparisonHtml(b);
    case "process":
      return processHtml(b);
    case "source":
      return (
        '<div class="pr-source"><blockquote class="pr-quote">' + rich(b.quote) + "</blockquote>" +
        (textOf(b.attribution) || textOf(b.date)
          ? '<p class="pr-src-attr">' + rich(b.attribution) +
            (textOf(b.date) ? ", " + rich(b.date) : "") + "</p>"
          : "") +
        (textOf(b.comment) ? '<p class="pr-p">' + rich(b.comment) + "</p>" : "") +
        "</div>"
      );
    case "statistic":
      return (
        '<div class="pr-stat"><span class="pr-stat-value">' + rich(b.value) + "</span>" +
        '<span class="pr-stat-side"><strong>' + rich(b.label) + "</strong>" +
        (textOf(b.context) ? "<br>" + rich(b.context) : "") +
        "</span></div>"
      );
    case "table":
      return tableHtml(b);
    case "timeline":
      return timelineHtml(b);
    case "image":
      if (!b.src) return "";
      return (
        '<figure class="pr-figure"><img src="' + String(b.src) + '" alt="" />' +
        (b.caption ? "<figcaption>" + escapeHtml(b.caption) + "</figcaption>" : "") +
        "</figure>"
      );
    case "video":
      return b.videoId
        ? '<p class="pr-link">Video: https://youtu.be/' + escapeHtml(b.videoId) + "</p>"
        : "";
    default:
      // Page links are handled by the subpage sections themselves.
      return "";
  }
}

function comparisonHtml(b) {
  let html =
    '<table class="pr-table"><tbody><tr><td><strong>' + rich(b.leftLabel) +
    "</strong></td><td><strong>" + rich(b.rightLabel) + "</strong></td></tr>";
  (b.rows || []).forEach((r) => {
    html += "<tr><td>" + rich(r.left) + "</td><td>" + rich(r.right) + "</td></tr>";
  });
  return html + "</tbody></table>";
}

function processHtml(b) {
  let html = '<ol class="pr-process">';
  (b.steps || []).forEach((st) => {
    html +=
      "<li>" + rich(st.text) +
      (textOf(st.why) ? '<span class="pr-why"> \u2014 ' + rich(st.why) + "</span>" : "") +
      "</li>";
  });
  return html + "</ol>";
}

function tableHtml(b) {
  const rows = Array.isArray(b.rows) ? b.rows : [];
  if (!rows.length) return "";
  let html = '<table class="pr-table"><thead><tr>';
  (rows[0] || []).forEach((c) => (html += "<th>" + rich(c) + "</th>"));
  html += "</tr></thead><tbody>";
  rows.slice(1).forEach((r) => {
    html += "<tr>";
    (r || []).forEach((c) => (html += "<td>" + rich(c) + "</td>"));
    html += "</tr>";
  });
  return html + "</tbody></table>";
}

function timelineHtml(b) {
  const items = Array.isArray(b.items) ? b.items : [];
  if (!items.length) return "";
  let html = '<div class="pr-timeline">';
  items.forEach((it) => {
    if (!textOf(it.date) && !textOf(it.title) && !textOf(it.detail)) return;
    html +=
      '<div class="pr-tl-item">' +
      '<div class="pr-tl-date">' + rich(it.date) + "</div>" +
      '<div class="pr-tl-body">' +
      '<div class="pr-tl-title">' + rich(it.title) + "</div>" +
      (textOf(it.detail) ? '<div class="pr-tl-detail">' + rich(it.detail) + "</div>" : "") +
      "</div></div>";
  });
  return html + "</div>";
}

/** Every page to print, depth first, so the contents list matches the order. */
function collect(pageId, includeSubpages, depth, acc) {
  const page = getPage(pageId);
  if (!page) return acc;
  acc.push({ page: page, depth: depth });
  if (includeSubpages) {
    getChildren(pageId).forEach((c) => collect(c.id, true, depth + 1, acc));
  }
  return acc;
}

/** One card, with the answer either printed or left blank to write in. */
function cardHtml(card, withAnswer) {
  return (
    '<div class="pr-card">' +
    '<div class="pr-card-q">' + rich(card.question) + "</div>" +
    (withAnswer
      ? '<div class="pr-card-a">' + blocksHtml(card.answer || [], { answers: true }) + "</div>"
      : '<div class="pr-card-blank"></div>') +
    "</div>"
  );
}

function cardsSection(pageId, opts) {
  if (!opts.cards) return "";
  const cards = cardsForPage(pageId) || [];
  if (!cards.length) return "";
  let html = '<div class="pr-cards"><div class="pr-cards-head">Flashcards</div>';
  cards.forEach((c) => {
    html += cardHtml(c, opts.answers);
  });
  return html + "</div>";
}

function buildDocument(pageId, opts) {
  const pages = collect(pageId, opts.subpages, 0, []);
  const first = pages[0].page;
  const today = formatDateHuman(new Date().toISOString().slice(0, 10));

  let html =
    '<div class="pr-doc">' +
    '<header class="pr-cover">' +
    '<div class="pr-brand">ReviseIQ revision notes</div>' +
    '<h1 class="pr-title">' + escapeHtml(first.title || "Untitled") + "</h1>" +
    '<div class="pr-meta">' +
    escapeHtml(today) +
    (pages.length > 1 ? " &middot; " + pages.length + " pages" : "") +
    "</div>" +
    "</header>";

  if (pages.length > 1) {
    html += '<nav class="pr-contents"><div class="pr-contents-head">Contents</div><ol>';
    pages.slice(1).forEach((p) => {
      html +=
        '<li class="pr-toc-d' + Math.min(p.depth, 3) + '">' +
        escapeHtml(p.page.title || "Untitled") +
        "</li>";
    });
    html += "</ol></nav>";
  }

  pages.forEach((entry, idx) => {
    const body = blocksHtml(entry.page.blocks || [], opts) + cardsSection(entry.page.id, opts);
    html +=
      '<section class="pr-section' + (idx === 0 ? " is-first" : "") + '">' +
      (idx === 0
        ? ""
        : '<h1 class="pr-section-title pr-depth-' + Math.min(entry.depth, 3) + '">' +
          escapeHtml(entry.page.title || "Untitled") +
          "</h1>") +
      (body || '<p class="pr-empty">No notes on this page yet.</p>') +
      "</section>";
  });

  return html + "</div>";
}

function cleanup() {
  document.body.classList.remove("printing");
  const el = document.getElementById(ROOT_ID);
  if (el) el.innerHTML = "";
}

function runPrint(pageId, opts) {
  printHtml(buildDocument(pageId, opts));
}

function printHtml(html) {
  printRoot().innerHTML = html;
  document.body.classList.add("printing");

  const done = () => {
    window.removeEventListener("afterprint", done);
    cleanup();
  };
  window.addEventListener("afterprint", done);

  // Give the layout a frame to settle (images, fonts) before the dialog opens,
  // and clean up anyway on browsers that never fire afterprint.
  setTimeout(() => {
    window.print();
    setTimeout(() => {
      if (document.body.classList.contains("printing")) done();
    }, 1500);
  }, 60);
}

/** Options sheet, then the print dialog. */
export function openPrintDialog(pageId) {
  const page = getPage(pageId);
  if (!page) return;
  const childCount = collect(pageId, true, 0, []).length - 1;

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML =
    '<div class="modal print-modal">' +
    "<h3>Export revision notes</h3>" +
    "<p>Prints a clean, typeset copy of these notes. Choose &ldquo;Save as PDF&rdquo; " +
    "as the destination to keep a file.</p>" +
    '<div class="print-opts">' +
    (childCount
      ? '<label class="print-opt"><input type="checkbox" data-pr-opt="subpages" checked /> ' +
        "<span>Include subpages <em>(" + childCount + ")</em></span></label>"
      : "") +
    '<label class="print-opt"><input type="checkbox" data-pr-opt="cards" checked /> ' +
    "<span>Include flashcards from these pages</span></label>" +
    '<label class="print-opt"><input type="checkbox" data-pr-opt="answers" checked /> ' +
    "<span>Show flashcard answers <em>(off makes it a self-test sheet)</em></span></label>" +
    "</div>" +
    '<div class="modal-actions">' +
    '<button class="btn-cancel" data-act="cancel">Cancel</button>' +
    '<button class="btn-primary" data-act="print">Create PDF</button>' +
    "</div></div>";

  // Mousedown, not click: the menu that opened this sheet closes on mousedown,
  // so the trailing click would otherwise land on the sheet and dismiss it.
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) {
      overlay.remove();
      return;
    }
    const btn = e.target.closest("button");
    if (!btn) return;
    const opts = {
      subpages: !!overlay.querySelector('[data-pr-opt="subpages"]:checked'),
      cards: !!overlay.querySelector('[data-pr-opt="cards"]:checked'),
      answers: !!overlay.querySelector('[data-pr-opt="answers"]:checked')
    };
    overlay.remove();
    if (btn.dataset.act === "print") runPrint(pageId, opts);
  });

  const host = document.getElementById("overlay-root") || document.body;
  host.appendChild(overlay);
}


/* ---------- weekly revision pack ---------- */

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const PACK_KIND = {
  due: "Flashcards",
  cards: "Flashcards",
  quiz: "Quiz",
  practise: "Practise",
  test: "Exam paper",
  read: "Read through",
  final: "Final review"
};

/** Every page the week touches, in the order it comes up. */
function packPages(days) {
  const seen = [];
  days.forEach((d) => {
    d.tasks.forEach((t) => {
      if (t.pageId && seen.indexOf(t.pageId) === -1 && getPage(t.pageId)) seen.push(t.pageId);
    });
  });
  return seen;
}

function packDays() {
  return weekOverview().map((d) => ({
    date: d.date,
    weekday: WEEKDAYS[new Date(d.date + "T00:00:00").getDay()],
    isToday: d.date === todayKey(),
    tasks: tasksFor(d.date)
  }));
}

function packSchedule(days) {
  let html = '<section class="pr-section is-first"><h1 class="pr-section-title">This week</h1>';
  days.forEach((d) => {
    html +=
      '<div class="pr-day"><div class="pr-day-head">' +
      escapeHtml(d.weekday) +
      (d.isToday ? " (today)" : "") +
      '<span class="pr-day-date">' + escapeHtml(formatDateHuman(d.date)) + "</span></div>";
    if (!d.tasks.length) {
      html += '<p class="pr-empty">Rest day.</p>';
    } else {
      d.tasks.forEach((t) => {
        html +=
          '<p class="pr-todo"><span class="pr-box">&nbsp;</span><strong>' +
          escapeHtml(PACK_KIND[t.kind] || t.kind) +
          "</strong> &middot; " +
          escapeHtml(t.title || "Untitled") +
          '<span class="pr-mins"> \u2014 ' + (t.minutes || 0) + " min</span></p>";
      });
    }
    html += "</div>";
  });
  return html + "</section>";
}

function packFocus() {
  const rows = openInsights().slice(0, 12);
  if (!rows.length) return "";
  let html =
    '<section class="pr-section"><h1 class="pr-section-title">Weak spots to close' +
    "</h1>";
  rows.forEach((i) => {
    html +=
      '<p class="pr-todo"><span class="pr-box">&nbsp;</span>' +
      escapeHtml(i.text || "") +
      (i.pageTitle ? '<span class="pr-mins"> \u2014 ' + escapeHtml(i.pageTitle) + "</span>" : "") +
      "</p>";
  });
  return html + "</section>";
}

function packNotes(pageIds, opts) {
  if (!opts.notes || !pageIds.length) return "";
  let html = "";
  pageIds.forEach((id) => {
    const page = getPage(id);
    if (!page) return;
    const body = blocksHtml(page.blocks || [], { answers: true });
    html +=
      '<section class="pr-section"><h1 class="pr-section-title">' +
      escapeHtml(page.title || "Untitled") +
      "</h1>" +
      (body || '<p class="pr-empty">No notes on this page yet.</p>') +
      "</section>";
  });
  return html;
}

function packSelfTest(opts) {
  if (!opts.cards) return "";
  const cards = dueCards(allCards()).slice(0, 40);
  if (!cards.length) return "";
  let html =
    '<section class="pr-section"><h1 class="pr-section-title">Self-test</h1>' +
    '<p class="pr-p">' + cards.length + " card" + (cards.length === 1 ? "" : "s") +
    " due this week. Cover the answers and write yours in the space.</p>";
  cards.forEach((c) => {
    html += cardHtml(c, false);
  });
  html += "</section>";

  if (opts.answers) {
    html += '<section class="pr-section"><h1 class="pr-section-title">Self-test answers</h1>';
    cards.forEach((c) => {
      html += cardHtml(c, true);
    });
    html += "</section>";
  }
  return html;
}

function buildPack(opts) {
  const days = packDays();
  const pages = packPages(days);
  const from = formatDateHuman(days[0].date);
  const to = formatDateHuman(days[days.length - 1].date);

  return (
    '<div class="pr-doc">' +
    '<header class="pr-cover">' +
    '<div class="pr-brand">ReviseIQ weekly revision pack</div>' +
    '<h1 class="pr-title">Week of ' + escapeHtml(from) + "</h1>" +
    '<div class="pr-meta">' + escapeHtml(from) + " &ndash; " + escapeHtml(to) +
    (pages.length ? " &middot; " + pages.length + " topic" + (pages.length === 1 ? "" : "s") : "") +
    "</div></header>" +
    packSchedule(days) +
    packFocus() +
    packNotes(pages, opts) +
    packSelfTest(opts) +
    "</div>"
  );
}

/**
 * Everything this week needs, on paper: the schedule, the weak spots to close,
 * the notes for the topics it covers and a self-test sheet of the cards that
 * fall due. Built from the plan, so it is never out of step with the app.
 */
export function openWeeklyPackDialog() {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML =
    '<div class="modal print-modal">' +
    "<h3>Weekly revision pack</h3>" +
    "<p>One document for the week ahead: your schedule, the weak spots to close, " +
    "the notes it covers and a self-test sheet. Choose &ldquo;Save as PDF&rdquo; to keep a file.</p>" +
    '<div class="print-opts">' +
    '<label class="print-opt"><input type="checkbox" data-pk-opt="notes" checked /> ' +
    "<span>Include the notes for this week&rsquo;s topics</span></label>" +
    '<label class="print-opt"><input type="checkbox" data-pk-opt="cards" checked /> ' +
    "<span>Include a self-test sheet of cards due</span></label>" +
    '<label class="print-opt"><input type="checkbox" data-pk-opt="answers" checked /> ' +
    "<span>Print the answers on a final page</span></label>" +
    "</div>" +
    '<div class="modal-actions">' +
    '<button class="btn-cancel" data-act="cancel">Cancel</button>' +
    '<button class="btn-primary" data-act="print">Create PDF</button>' +
    "</div></div>";

  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) {
      overlay.remove();
      return;
    }
    const btn = e.target.closest("button");
    if (!btn) return;
    const opts = {
      notes: !!overlay.querySelector('[data-pk-opt="notes"]:checked'),
      cards: !!overlay.querySelector('[data-pk-opt="cards"]:checked'),
      answers: !!overlay.querySelector('[data-pk-opt="answers"]:checked')
    };
    overlay.remove();
    if (btn.dataset.act === "print") printHtml(buildPack(opts));
  });

  const host = document.getElementById("overlay-root") || document.body;
  host.appendChild(overlay);
}

export function printCurrentPage() {
  if (store.state && store.state.activePageId) openPrintDialog(store.state.activePageId);
}
