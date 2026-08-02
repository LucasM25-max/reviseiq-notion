// Full-screen revision session built on the flashcard (toggle) blocks.
import { escapeHtml } from "../utils.js";
import { getPage } from "../state.js";
import { iconImg, ui, DEFAULT_CALLOUT_ICON } from "../icons.js";
import { scheduleSave } from "../storage.js";
import { cardsForPage, allCards, dueCards, sortForRevision, gradeCard, nextIntervalLabel } from "../srs.js";

let session = null;
let keyHandler = null;
let onClose = () => {};

export function setReviseCloseHandler(fn) {
  onClose = fn;
}

/**
 * scope: { type: "page", pageId } | { type: "all" }
 * mode:  "due" (default) | "everything"
 */
export function startRevise(scope, mode) {
  const base = scope.type === "page" ? cardsForPage(scope.pageId) : allCards();
  const queue = mode === "everything" ? sortForRevision(base) : dueCards(base);
  const title =
    scope.type === "page" ? getPage(scope.pageId) ? getPage(scope.pageId).title || "Untitled" : "Revise" : "All subjects";

  session = {
    scope,
    title,
    queue,
    total: queue.length,
    done: 0,
    revealed: false,
    graded: {}
  };

  const overlay = document.createElement("div");
  overlay.className = "revise-overlay";
  overlay.id = "revise-overlay";
  document.getElementById("overlay-root").appendChild(overlay);

  keyHandler = (e) => handleKey(e);
  document.addEventListener("keydown", keyHandler, true);

  overlay.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-revise-act]");
    if (!btn) return;
    const act = btn.dataset.reviseAct;
    if (act === "close") closeRevise();
    else if (act === "reveal") reveal();
    else if (act === "restart") startRevise(session.scope, "everything");
    else if (act === "open-page") {
      const pid = btn.dataset.pageId;
      closeRevise(pid);
    } else grade(act);
  });

  paint();
}

export function closeRevise(navigateToPageId) {
  const el = document.getElementById("revise-overlay");
  if (el) el.remove();
  if (keyHandler) document.removeEventListener("keydown", keyHandler, true);
  keyHandler = null;
  session = null;
  scheduleSave();
  onClose(navigateToPageId || null);
}

function handleKey(e) {
  if (!session) return;
  if (e.key === "Escape") {
    e.preventDefault();
    closeRevise();
    return;
  }
  if (!session.queue.length) return;
  if (!session.revealed) {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      reveal();
    }
    return;
  }
  if (e.key === "1") {
    e.preventDefault();
    grade("again");
  } else if (e.key === "2") {
    e.preventDefault();
    grade("almost");
  } else if (e.key === "3" || e.key === " " || e.key === "Enter") {
    e.preventDefault();
    grade("good");
  }
}

function reveal() {
  if (!session) return;
  session.revealed = true;
  paint();
}

function grade(which) {
  if (!session || !session.queue.length) return;
  if (["good", "almost", "again"].indexOf(which) === -1) return;
  const card = session.queue[0];
  gradeCard(card.id, which);
  session.graded[which] = (session.graded[which] || 0) + 1;
  session.queue.shift();
  if (which === "again") {
    // Keep it in this session so it is seen again before finishing.
    session.queue.push(card);
  } else {
    session.done += 1;
  }
  session.revealed = false;
  scheduleSave();
  paint();
}

/* ---------- painting ---------- */

function paint() {
  const overlay = document.getElementById("revise-overlay");
  if (!overlay || !session) return;

  if (!session.queue.length) {
    overlay.innerHTML = renderFinished();
    return;
  }

  const card = session.queue[0];
  const progress = session.total ? Math.round((session.done / session.total) * 100) : 0;

  overlay.innerHTML =
    '<div class="revise-shell">' +
    '<div class="revise-top">' +
    '<div class="revise-scope">' +
    iconImg(card.pageIcon, 16) +
    "<span>" +
    escapeHtml(card.pageTitle) +
    "</span></div>" +
    '<div class="revise-count">' +
    session.done +
    " / " +
    session.total +
    "</div>" +
    '<button class="revise-close" data-revise-act="close" title="Finish (Esc)">' +
    ui("close", 16, 2.2) +
    "</button>" +
    "</div>" +
    '<div class="revise-progress"><div class="revise-progress-fill" style="width:' + progress + '%"></div></div>' +
    '<div class="revise-card">' +
    '<div class="revise-q-label">Question</div>' +
    '<div class="revise-question">' +
    (card.question || "<em>Untitled card</em>") +
    "</div>" +
    (session.revealed
      ? '<div class="revise-answer"><div class="revise-a-label">Answer</div>' +
        (renderStatic(card.answer) || '<p class="revise-empty-answer">This card has no answer content yet.</p>') +
        "</div>"
      : '<button class="revise-reveal" data-revise-act="reveal">Show answer <span class="revise-kbd">Space</span></button>') +
    "</div>" +
    (session.revealed
      ? '<div class="revise-grades">' +
        gradeBtn("again", "No idea", card.id, "1") +
        gradeBtn("almost", "Almost", card.id, "2") +
        gradeBtn("good", "Got it", card.id, "3") +
        "</div>"
      : '<div class="revise-hint">Try to answer out loud first, then reveal.</div>') +
    '<button class="revise-jump" data-revise-act="open-page" data-page-id="' +
    card.pageId +
    '">Open this page' +
    ui("arrowRight", 13) +
    "</button>" +
    "</div>";
}

function gradeBtn(act, label, cardId, key) {
  return (
    '<button class="revise-grade g-' +
    act +
    '" data-revise-act="' +
    act +
    '"><span class="g-label">' +
    label +
    '</span><span class="g-when">' +
    nextIntervalLabel(act, cardId) +
    '</span><span class="revise-kbd">' +
    key +
    "</span></button>"
  );
}

function renderFinished() {
  const reviewed = session.done;
  return (
    '<div class="revise-shell">' +
    '<div class="revise-top"><div class="revise-scope">' +
    iconImg("trophy", 16) +
    "<span>" +
    escapeHtml(session.title) +
    "</span></div>" +
    '<button class="revise-close" data-revise-act="close" title="Close (Esc)">' +
    ui("close", 16, 2.2) +
    "</button></div>" +
    '<div class="revise-done">' +
    '<div class="revise-done-icon">' +
    iconImg(reviewed ? "trophy" : "check", 48) +
    "</div>" +
    "<h2>" +
    (reviewed ? "Session complete" : "Nothing due right now") +
    "</h2>" +
    "<p>" +
    (reviewed
      ? "You reviewed " + reviewed + " card" + (reviewed === 1 ? "" : "s") + ". They'll come back around automatically when it's time."
      : "Every card here is scheduled for a future day. You can still run through them all for extra practice.") +
    "</p>" +
    '<div class="revise-done-actions">' +
    '<button class="revise-secondary" data-revise-act="restart">Revise everything anyway</button>' +
    '<button class="revise-primary" data-revise-act="close">Done</button>' +
    "</div></div></div>"
  );
}

/* ---------- read-only block rendering for answers ---------- */

export function renderStatic(blocks) {
  if (!Array.isArray(blocks)) return "";
  let html = "";
  let n = 0;
  blocks.forEach((b) => {
    if (!b) return;
    if (b.type !== "numbered") n = 0;
    switch (b.type) {
      case "paragraph":
        if (String(b.content || "").replace(/<[^>]+>/g, "").trim() === "") break;
        html += "<p>" + b.content + "</p>";
        break;
      case "heading1":
        html += "<h3>" + b.content + "</h3>";
        break;
      case "heading2":
      case "heading3":
        html += "<h4>" + b.content + "</h4>";
        break;
      case "quote":
        html += "<blockquote>" + b.content + "</blockquote>";
        break;
      case "bulleted":
        html += '<div class="rs-li"><span class="rs-marker">\u2022</span><span>' + b.content + "</span></div>";
        break;
      case "numbered":
        n += 1;
        html += '<div class="rs-li"><span class="rs-marker">' + n + ".</span><span>" + b.content + "</span></div>";
        break;
      case "todo":
        html +=
          '<div class="rs-li"><span class="rs-marker">' +
          (b.checked ? "\u2713" : "\u25a1") +
          "</span><span>" +
          b.content +
          "</span></div>";
        break;
      case "callout":
        html +=
          '<div class="rs-callout">' +
          iconImg(b.icon, 18, "", DEFAULT_CALLOUT_ICON) +
          "<div>" +
          b.content +
          "</div></div>";
        break;
      case "code":
        html += "<pre class=\"rs-code\">" + escapeHtml(b.content || "") + "</pre>";
        break;
      case "divider":
        html += '<hr class="rs-divider" />';
        break;
      case "image":
        if (b.src) html += '<img class="rs-image" src="' + b.src + '" alt="" />';
        break;
      case "table":
        html += '<table class="rs-table"><tbody>';
        (b.rows || []).forEach((row) => {
          html += "<tr>";
          row.forEach((cell) => {
            html += "<td>" + escapeHtml(cell) + "</td>";
          });
          html += "</tr>";
        });
        html += "</tbody></table>";
        break;
      case "toggle":
        html +=
          '<div class="rs-sub"><div class="rs-sub-title">' +
          (b.summary || "") +
          "</div>" +
          renderStatic(b.children) +
          "</div>";
        break;
      default:
        break;
    }
  });
  return html;
}
