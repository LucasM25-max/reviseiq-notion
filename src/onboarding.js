/*
 * First-run walkthrough. Points out what's already on screen and explains
 * it - nothing here creates a subject, a page, or any other seed content.
 * A student who skips it, or who never sees it because they imported a
 * backup on their very first visit, ends up with exactly the same app.
 */
import { escapeHtml } from "./utils.js";

const SEEN_KEY = "reviseiq_onboarding_v1_seen";

function isMobile() {
  return typeof window.matchMedia === "function" && window.matchMedia("(max-width: 860px)").matches;
}

/* Each step either points at a real, already-visible element (`target`) or
   stands alone as a plain explanatory card (`target: null`). `target` may
   be a selector string or a function returning one, for steps whose target
   differs between desktop and mobile. */
const STEPS = [
  {
    title: "Welcome to ReviseIQ",
    body: "A minute-long look at what's here \u2014 skip it any time, or replay it later from the sidebar.",
    target: null
  },
  {
    title: "Start with a subject",
    body: "Every GCSE course gets its own subject. Pages, and pages within pages, nest underneath it \u2014 a whole subject down to a single topic.",
    target: "#btn-new-subject"
  },
  {
    title: "Your subjects and pages",
    body: "Subjects and their pages live in this list. Click one to open it, use the arrow to expand it, and drag to reorder.",
    target: "#sidebar-tree"
  },
  {
    title: "Your revision plan",
    body: "A daily plan built from your exam dates and how confident you've marked each topic \u2014 what's worth revising today, not just what's left overall.",
    target: "#today-nav-btn"
  },
  {
    title: "Exam calendar",
    body: "Add exam dates on a subject's page and they show up here. The plan uses them to prioritise whatever's coming up soonest.",
    target: "#calendar-nav-btn"
  },
  {
    title: "Flashcards",
    body: "Add a \u201cKey term\u201d block anywhere in your notes and it automatically becomes a flashcard here, ready for spaced-repetition review. The number shows how many are due today.",
    target: "#revise-nav-btn"
  },
  {
    title: "Search everything",
    body: "Search page titles, notes, key terms and tables from anywhere in the app. Click a result to jump straight to it.",
    target: () => (isMobile() ? "#mobile-search-btn" : "#search-toggle-btn")
  },
  {
    title: "Back up your notes",
    body: "Export downloads everything as one file \u2014 worth doing now and then. Import restores from a backup file if you ever need to.",
    target: ".backup-row"
  },
  {
    title: "Sign in to sync",
    body: "If cloud sync is switched on for this site, signing in here backs up your notes and keeps them in sync on your other devices. Entirely optional \u2014 everything already saves to this browser on its own.",
    target: "#cloud-slot"
  },
  {
    title: "Writing notes",
    body: "Type \u201c/\u201d at the start of any line to insert headings, bullet lists, tables, timelines, key terms and more. Everything saves automatically as you type.",
    target: null
  },
  {
    title: "Quiz, Practise and Test yourself",
    body: "Once a page has enough notes, three tools appear at the top of it: Quiz me (multiple choice), Practise (short written questions) and Test me (a full mock paper) \u2014 all generated from what you've actually written.",
    target: null
  },
  {
    title: "That's the tour",
    body: "You can replay this any time from \u201cReplay walkthrough\u201d at the bottom of the sidebar.",
    target: null
  }
];

let index = 0;
let scrimEl = null;
let cardEl = null;
let glowEl = null;

function resolveTarget(step) {
  const sel = typeof step.target === "function" ? step.target() : step.target;
  if (!sel) return null;
  const el = document.querySelector(sel);
  return el || null;
}

function clearGlow() {
  if (glowEl) glowEl.classList.remove("onboard-glow");
  glowEl = null;
}

function teardown() {
  clearGlow();
  if (scrimEl) scrimEl.remove();
  scrimEl = null;
  cardEl = null;
}

function close(markSeen) {
  teardown();
  if (markSeen) {
    try {
      window.localStorage.setItem(SEEN_KEY, "1");
    } catch (e) {
      /* ignore - a missing flag just means the tour offers again next time */
    }
  }
}

function positionFloating(card, target) {
  const rect = target.getBoundingClientRect();
  const margin = 12;
  card.style.top = "0px";
  card.style.left = "0px";
  const cardRect = card.getBoundingClientRect();

  let top = rect.bottom + margin;
  if (top + cardRect.height > window.innerHeight - margin) {
    top = rect.top - cardRect.height - margin;
  }
  top = Math.max(margin, Math.min(top, window.innerHeight - cardRect.height - margin));

  let left = rect.left;
  left = Math.max(margin, Math.min(left, window.innerWidth - cardRect.width - margin));

  card.style.top = top + "px";
  card.style.left = left + "px";
}

function renderCardHtml(step, i) {
  return (
    '<div class="onboard-eyebrow">Step ' +
    (i + 1) +
    " of " +
    STEPS.length +
    "</div>" +
    '<h3 class="onboard-title">' +
    escapeHtml(step.title) +
    "</h3>" +
    '<p class="onboard-body">' +
    escapeHtml(step.body) +
    "</p>" +
    '<div class="onboard-controls">' +
    '<button type="button" class="onboard-skip" id="onboard-skip">Skip tour</button>' +
    '<span class="onboard-spacer"></span>' +
    '<button type="button" class="onboard-back" id="onboard-back"' +
    (i === 0 ? " disabled" : "") +
    ">Back</button>" +
    '<button type="button" class="onboard-next" id="onboard-next">' +
    (i === STEPS.length - 1 ? "Finish" : "Next") +
    "</button>" +
    "</div>"
  );
}

function wireControls(root) {
  const skip = root.querySelector("#onboard-skip");
  const back = root.querySelector("#onboard-back");
  const next = root.querySelector("#onboard-next");
  if (skip) skip.addEventListener("click", () => close(true));
  if (back)
    back.addEventListener("click", () => {
      if (index > 0) {
        index -= 1;
        render();
      }
    });
  if (next)
    next.addEventListener("click", () => {
      if (index >= STEPS.length - 1) {
        close(true);
        return;
      }
      index += 1;
      render();
    });
}

function render() {
  clearGlow();
  if (scrimEl) scrimEl.remove();

  const step = STEPS[index];
  const target = isMobile() ? null : resolveTarget(step);

  if (target) {
    // Floating, non-blocking card next to a real, still-usable element.
    scrimEl = document.createElement("div");
    scrimEl.className = "onboard-card-host";
    const card = document.createElement("div");
    card.className = "onboard-card";
    card.innerHTML = renderCardHtml(step, index);
    scrimEl.appendChild(card);
    document.body.appendChild(scrimEl);
    cardEl = card;
    wireControls(card);

    target.classList.add("onboard-glow");
    glowEl = target;
    positionFloating(card, target);
  } else {
    // No specific target (or on a phone, where nothing stays targeted) -
    // a plain centred card over a dimmed backdrop, like any other modal.
    scrimEl = document.createElement("div");
    scrimEl.className = "onboard-scrim";
    const card = document.createElement("div");
    card.className = "onboard-card";
    card.innerHTML = renderCardHtml(step, index);
    scrimEl.appendChild(card);
    document.body.appendChild(scrimEl);
    cardEl = card;
    wireControls(card);
  }
}

function start() {
  index = 0;
  render();
}

function alreadySeen() {
  try {
    return window.localStorage.getItem(SEEN_KEY) === "1";
  } catch (e) {
    return false;
  }
}

/** Wires the replay button. Call once at boot. */
export function initOnboarding() {
  const replayBtn = document.getElementById("onboard-replay-btn");
  if (replayBtn) replayBtn.addEventListener("click", start);

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && scrimEl) close(true);
  });
  window.addEventListener("resize", () => {
    if (scrimEl && cardEl && glowEl) positionFloating(cardEl, glowEl);
  });

  if (!alreadySeen()) {
    // Let the very first paint (sidebar, plan view) settle before pointing
    // at anything.
    setTimeout(start, 400);
  }
}
