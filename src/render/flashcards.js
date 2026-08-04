/*
 * Flashcards: a revision session built on the flashcard (toggle) blocks.
 *
 * On a phone this is a genuine full-screen overlay - nothing else on screen.
 * On a desktop it renders inside the main column with the sidebar still there,
 * so you never lose your place in the workspace.
 */
import { escapeHtml, sanitizeHtmlFragment } from "../utils.js";
import { getPage, store, setCurrentView } from "../state.js";
import { iconImg, ui, DEFAULT_CALLOUT_ICON } from "../icons.js";
import { scheduleSave } from "../storage.js";
import { cardsForPage, allCards, dueCards, sortForRevision, gradeCard, nextIntervalLabel, todayKey } from "../srs.js";
import { markTaskDone } from "../plan/store.js";

/* Phones get the overlay; anything wider keeps the app around the session.
   Matches MOBILE_MAX in src/events/mobileEvents.js. */
const MOBILE_MAX = 860;

function isPhone() {
  return window.innerWidth <= MOBILE_MAX;
}

let session = null;
let keyHandler = null;
let clickHandler = null;
let swipeTarget = null;
let onClose = () => {};
let rerender = () => {};
let onNextTask = null;

export function setFlashcardsCloseHandler(fn) {
  onClose = fn;
}

/** How the desktop view repaints itself (set from src/main.js to avoid a cycle). */
export function setFlashcardsRerender(fn) {
  rerender = fn;
}

/** What "Next task" does, supplied by the Plan event wiring. */
export function setFlashcardsNextTask(fn) {
  onNextTask = fn;
}

export function flashcardsActive() {
  return session !== null;
}

function hostEl() {
  return document.getElementById("revise-overlay") || document.getElementById("flashcards-host");
}

/**
 * scope: { type: "page", pageId } | { type: "all" }
 * mode:  "due" (default) | "everything"
 * task:  optional { id, date, minutes } so finishing ticks off the plan
 */
export function startFlashcards(scope, mode, task) {
  const base = scope.type === "page" ? cardsForPage(scope.pageId) : allCards();
  const queue = mode === "everything" ? sortForRevision(base) : dueCards(base);
  const title =
    scope.type === "page" ? getPage(scope.pageId) ? getPage(scope.pageId).title || "Untitled" : "Revise" : "All subjects";

  session = {
    scope,
    mode: mode === "everything" ? "everything" : "due",
    title,
    queue,
    total: queue.length,
    done: 0,
    revealed: false,
    graded: {},
    task: task || null,
    overlay: isPhone(),
    returnView: store.currentView === "flashcards" ? "plan" : store.currentView,
    returnPageId: store.state.activePageId
  };

  if (session.overlay) {
    const overlay = document.createElement("div");
    overlay.className = "revise-overlay";
    overlay.id = "revise-overlay";
    document.getElementById("overlay-root").appendChild(overlay);
  } else {
    setCurrentView("flashcards");
    rerender();
  }

  attachHandlers();
  paint();
}

/* One set of delegated listeners covers both the overlay and the in-app view. */
function attachHandlers() {
  if (!keyHandler) {
    keyHandler = (e) => handleKey(e);
    document.addEventListener("keydown", keyHandler, true);
  }
  if (!clickHandler) {
    clickHandler = (e) => {
      if (!session) return;
      const btn = e.target.closest("[data-revise-act]");
      if (!btn) return;
      const act = btn.dataset.reviseAct;
      if (act === "close") closeFlashcards();
      else if (act === "reveal") reveal();
      else if (act === "restart") startFlashcards(session.scope, "everything", session.task);
      else if (act === "plan") closeFlashcards(null, "plan");
      else if (act === "next-task") {
        const next = onNextTask;
        closeFlashcards(null, "plan");
        if (next) next();
      } else if (act === "open-page") closeFlashcards(btn.dataset.pageId);
      else grade(act);
    };
    document.addEventListener("click", clickHandler);
  }
  if (swipeTarget !== document) {
    swipeTarget = document;
    attachSwipe(document);
  }
}

/*
 * Touch gestures for phone use:
 *   swipe up/down is left alone (scrolling long answers)
 *   swipe right  -> reveal, then grade "good"
 *   swipe left   -> reveal, then grade "again"
 * The card follows the finger so the gesture is discoverable.
 */
function attachSwipe(overlay) {
  let startX = 0;
  let startY = 0;
  let card = null;
  let tracking = false;

  overlay.addEventListener(
    "touchstart",
    (e) => {
      if (!session || e.touches.length !== 1) return;
      card = e.target.closest(".revise-card");
      if (!card) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      tracking = true;
    },
    { passive: true }
  );

  overlay.addEventListener(
    "touchmove",
    (e) => {
      if (!tracking || !card) return;
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;
      if (Math.abs(dy) > Math.abs(dx)) return; // let the page scroll
      card.classList.add("swiping");
      card.style.transform = "translateX(" + dx * 0.5 + "px) rotate(" + dx * 0.012 + "deg)";
    },
    { passive: true }
  );

  const finish = (e) => {
    if (!tracking || !card) return;
    const t = e.changedTouches ? e.changedTouches[0] : null;
    const dx = t ? t.clientX - startX : 0;
    const dy = t ? Math.abs(t.clientY - startY) : 0;
    card.classList.remove("swiping");
    card.style.transform = "";
    tracking = false;
    if (!session || dy > 70 || Math.abs(dx) < 70) {
      card = null;
      return;
    }
    const right = dx > 0;
    card.classList.add(right ? "swipe-out-right" : "swipe-out-left");
    card = null;
    // A swipe on a hidden answer just reveals it; you should never grade a
    // card you have not looked at.
    if (!session.revealed) {
      reveal();
      return;
    }
    grade(right ? "good" : "again");
  };

  overlay.addEventListener("touchend", finish, { passive: true });
  overlay.addEventListener("touchcancel", finish, { passive: true });
}

export function closeFlashcards(navigateToPageId, forceView) {
  if (!session) return;
  const wasInView = !session.overlay;
  const back = forceView || session.returnView || "plan";
  // Getting through cards is the task, so ticking it off is automatic.
  if (session.task && session.done > 0) {
    markTaskDone(session.task.date || todayKey(), session.task.id, session.task.minutes || 0);
  }
  const el = document.getElementById("revise-overlay");
  if (el) el.remove();
  if (keyHandler) document.removeEventListener("keydown", keyHandler, true);
  if (clickHandler) document.removeEventListener("click", clickHandler);
  keyHandler = null;
  clickHandler = null;
  session = null;
  scheduleSave();
  if (wasInView && !navigateToPageId) {
    setCurrentView(back === "flashcards" ? "plan" : back);
  }
  onClose(navigateToPageId || null);
}

function handleKey(e) {
  if (!session) return;
  if (e.key === "Escape") {
    e.preventDefault();
    closeFlashcards();
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
  const host = hostEl();
  if (!host || !session) return;
  host.innerHTML = shellHtml();
}

/** The session markup. Used by the overlay and by renderFlashcardsView(). */
export function renderFlashcardsView() {
  return '<div id="flashcards-host" class="revise-host">' + shellHtml() + "</div>";
}

function shellHtml() {
  if (!session) return "";
  if (!session.queue.length) return renderFinished();

  const card = session.queue[0];
  const progress = session.total ? Math.round((session.done / session.total) * 100) : 0;

  return (
    '<div class="revise-shell' + (session.overlay ? "" : " in-view") + '">' +
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
    "</div>"
  );
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
  const hasNext = typeof onNextTask === "function";
  return (
    '<div class="revise-shell' + (session.overlay ? "" : " in-view") + '">' +
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
    (session.mode === "everything"
      ? ""
      : '<button class="revise-secondary" data-revise-act="restart">Go through them all anyway</button>') +
    '<button class="revise-secondary" data-revise-act="plan">Back to plan</button>' +
    (hasNext ? '<button class="revise-primary" data-revise-act="next-task">Next task</button>' : "") +
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
            html += "<td>" + sanitizeHtmlFragment(cell) + "</td>";
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
