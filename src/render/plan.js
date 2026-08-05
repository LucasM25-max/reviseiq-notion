/*
 * The Plan view: a dated revision schedule that works backwards from your
 * exams. Replaces the old Today page.
 *
 * The screen has one job: show the next thing to do. Everything analytical is
 * folded away behind "Progress" so that opening the app never feels like
 * opening a dashboard.
 */
import { escapeHtml, formatDateHuman } from "../utils.js";
import { computeNextExam } from "../exams.js";
import { iconImg, ui } from "../icons.js";
import {
  countDueEverywhere,
  currentStreak,
  reviewedToday,
  weeklyCounts,
  allCards,
  todayKey
} from "../srs.js";
import { topicUnits } from "../plan/engine.js";
import { subjectStanding, standingSummary } from "../readiness.js";
import {
  ensurePlan,
  isSetupDone,
  planSettings,
  regeneratePlan,
  todayTasks,
  isTaskDone,
  isTaskSkipped,
  minutesDone,
  weekOverview,
  upcomingDays,
  capacityOn,
  pullPreview,
  slipReport,
  paceSummary,
  digestDismissed,
  health
} from "../plan/store.js";
import { renderFeedbackSection } from "./insights.js";
import { renderWorkSection } from "./work.js";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const KIND_LABEL = {
  due: "Flashcards due",
  cards: "Flashcards",
  quiz: "Quiz me",
  practise: "Practise",
  test: "Mock paper",
  read: "Learn it",
  final: "Final review"
};
const KIND_SHORT = { due: "Cards", cards: "Cards", quiz: "Quiz", practise: "Practise", test: "Paper", read: "Read", final: "Review" };
const KIND_ICON = { due: "cards", cards: "cards", quiz: "question", practise: "marksheet", test: "exam", read: "notebook", final: "target" };
const KIND_ACTION = { due: "Start", cards: "Start", quiz: "Quiz me", practise: "Practise", test: "Sit it", read: "Open", final: "Start" };

/* View-local UI state. Deliberately not persisted: every visit starts calm. */
let settingsOpen = false;
let timelineOpen = false;
let progressOpen = false;
let listOpen = false;
let expandedId = "";

export function togglePlanSettings(force) {
  settingsOpen = force === undefined ? !settingsOpen : !!force;
}

export function togglePlanTimeline() {
  timelineOpen = !timelineOpen;
}

export function togglePlanProgress() {
  progressOpen = !progressOpen;
}

export function togglePlanList() {
  listOpen = !listOpen;
}

/** Reveals the reasoning and controls on one row, for touch users. */
export function expandPlanTask(id) {
  expandedId = expandedId === id ? "" : id || "";
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function shorten(s, n) {
  const t = String(s || "");
  return t.length > n ? t.slice(0, n - 1) + "\u2026" : t;
}

function outstanding(dateKey, tasks) {
  return tasks.filter((t) => !isTaskDone(dateKey, t.id) && !isTaskSkipped(dateKey, t.id));
}

export function renderPlanView() {
  ensurePlan();
  const setup = !isSetupDone();
  if (!setup) regeneratePlan(false);

  let html =
    '<div class="breadcrumbs"><span class="crumb current">' +
    iconImg("checklist", 14) +
    '<span class="crumb-text">Plan</span></span></div>';
  html += '<div class="page-header"><div class="page-title">' + escapeHtml(greeting()) + "</div></div>";

  if (setup) {
    html +=
      '<div class="today-sub">Tell me how much time you have and your revision is planned all the way to your last exam.</div>';
    html += renderSetupCard(true);
    return html;
  }

  html += renderOneLine();
  html += renderDigest();
  html += renderSlip();
  html += renderTrimNote();
  if (settingsOpen) html += renderSetupCard(false);
  html += renderTodayFocus();
  html += renderWeekStrip();
  html += renderTimeline();
  html += renderProgressSection();
  return html;
}

/* ---------- the single status line (replaces the old stat cards) ---------- */

function renderOneLine() {
  const key = todayKey();
  const tasks = todayTasks();
  const left = outstanding(key, tasks);
  const mins = left.reduce((s, t) => s + (t.minutes || 0), 0);
  const due = countDueEverywhere();
  const streak = currentStreak();
  const next = computeNextExam();
  const bits = [];

  if (left.length) {
    bits.push(
      '<span class="pl-line-bit is-key">' +
        ui("stopwatch", 13) +
        mins +
        " min left today</span>"
    );
  } else if (tasks.length) {
    bits.push('<span class="pl-line-bit is-good">' + ui("check", 13, 2.6) + "today is done</span>");
  }
  if (streak > 0) {
    bits.push('<span class="pl-line-bit">' + ui("flame", 13) + streak + "-day streak</span>");
  }
  if (due > 0) {
    bits.push('<span class="pl-line-bit">' + ui("flashcard", 13) + due + " card" + (due === 1 ? "" : "s") + " due</span>");
  }
  if (next) {
    bits.push(
      '<span class="pl-line-bit' +
        (next.days <= 7 ? " is-urgent" : "") +
        '">' +
        ui("calendar", 13) +
        (next.days === 0 ? escapeHtml(shorten(next.name, 26)) + " is today" : next.days + " day" + (next.days === 1 ? "" : "s") + " to " + escapeHtml(shorten(next.name, 26))) +
        "</span>"
    );
  } else {
    bits.push('<span class="pl-line-bit">' + ui("calendar", 13) + "no exam dates set yet</span>");
  }
  return '<div class="pl-oneline">' + bits.join("") + "</div>";
}

/* ---------- weekly digest: information arrives, then leaves ---------- */

function digestPoints() {
  const points = [];
  const h = health();
  const standing = subjectStanding();

  if (h.behind) {
    points.push(
      "about " + h.droppedMinutes + " minutes of work will not fit before your exams at your current time per day"
    );
  }
  // The digest and the standing card read the same aggregate, so the two can
  // never tell the student different stories about the same subject.
  const moved = standing
    .filter((x) => x.trend && x.trend.dir !== "flat")
    .sort((a, b) => Math.abs(b.trend.delta) - Math.abs(a.trend.delta))[0];
  if (moved) {
    points.push(
      escapeHtml(moved.title) +
        " is " +
        (moved.trend.dir === "up" ? "up " : "down ") +
        Math.abs(moved.trend.delta) +
        " percentage points on your recent marked work"
    );
  }
  const weakest = [];
  standing.forEach((x) => x.weak.forEach((w) => weakest.push(w)));
  weakest.sort((a, b) => a.r - b.r);
  if (weakest[0]) {
    points.push(
      escapeHtml(weakest[0].title) + " is your weakest topic \u2014 " + weakest[0].reason
    );
  }
  const untested = standing.reduce((n, x) => n + x.topics - x.examined, 0);
  if (untested) {
    points.push(untested + " topic" + (untested === 1 ? " has" : "s have") + " never been quizzed, papered or carded");
  }
  const pace = paceSummary()[0];
  if (pace && Math.abs(pace.factor - 1) > 0.15) {
    points.push(
      (KIND_LABEL[pace.kind] || pace.kind).toLowerCase() +
        " sessions really take you about " +
        pace.average +
        " minutes, so the plan now allows for that"
    );
  }
  const reviewed = weeklyCounts(7).reduce((s, d) => s + d.count, 0);
  if (reviewed) points.push(reviewed + " cards reviewed in the last seven days");
  return points;
}

function renderDigest() {
  if (digestDismissed()) return "";
  const points = digestPoints();
  if (points.length < 2) return "";
  return (
    '<div class="pl-digest"><div class="pl-digest-head">' +
    ui("chart", 14) +
    "<span>This week so far</span>" +
    '<button class="pl-digest-close" data-plan-act="digest-dismiss" title="Dismiss until next week">' +
    ui("close", 12, 2.2) +
    "</button></div><ul class=\"pl-digest-list\">" +
    points
      .slice(0, 4)
      .map((p) => "<li>" + p + "</li>")
      .join("") +
    "</ul></div>"
  );
}

/* ---------- the honest slip card ---------- */

/* What each step of automatic trimming actually costs, said once. */
const TRIM_NOTE = {
  1: "Reading tasks have been dropped so the time goes on retrieval.",
  2: "Scope is narrowed to fit: one pass fewer per topic and no reading tasks.",
  3: "Scope is cut hard to fit: two passes fewer per topic and no reading tasks."
};

function renderTrimNote() {
  const h = health();
  if (h.behind || !h.trim) return "";
  const byHand = planSettings().narrowScope;
  return (
    '<div class="pl-trim">' +
    ui("check", 13) +
    "<span>" +
    escapeHtml(TRIM_NOTE[h.trim] || TRIM_NOTE[2]) +
    " Everything fits.</span>" +
    (byHand
      ? '<button class="pl-link" data-plan-act="narrow" data-on="0">Restore full coverage</button>'
      : '<button class="pl-link" data-plan-act="add-time" data-minutes="15">Add 15 min a day</button>') +
    "</div>"
  );
}

function renderSlip() {
  const s = slipReport(7);
  if (!s.slipping && !s.behind) return "";
  const extra = s.suggestedExtra || 15;
  let text = "";
  if (s.slipping) {
    text =
      "You have missed " +
      s.count +
      " session" +
      (s.count === 1 ? "" : "s") +
      " in the last week \u2014 about " +
      s.minutes +
      " minutes of work. ";
  }
  if (s.behind) {
    text +=
      "Even at the narrowest scope, roughly " +
      health().droppedMinutes +
      " minutes of work has nowhere to go before your exams.";
  } else {
    text += "Everything still fits, but it is worth deciding rather than drifting.";
  }
  const narrowed = planSettings().narrowScope;
  return (
    '<div class="pl-slip"><div class="pl-slip-head">' +
    ui("warning", 14) +
    "<span>" +
    (s.behind ? "There is not enough time left" : "You have slipped a little") +
    "</span></div><div class=\"pl-slip-text\">" +
    text +
    '</div><div class="pl-slip-actions">' +
    '<button class="pl-btn" data-plan-act="add-time" data-minutes="' +
    extra +
    '">Add ' +
    extra +
    " min a day</button>" +
    '<button class="pl-btn-quiet" data-plan-act="narrow" data-on="' +
    (narrowed ? "0" : "1") +
    '">' +
    (narrowed ? "Restore full coverage" : "Narrow the scope instead") +
    "</button></div>" +
    '<div class="pl-slip-note">' +
    (narrowed
      ? "Scope is narrowed: one pass fewer per topic and no reading tasks, so the time goes to the weakest material."
      : "Narrowing drops one pass per topic and all reading tasks, keeping your time on the topics that carry the most marks.") +
    "</div></div>"
  );
}

/* ---------- setup / settings ---------- */

function minsField(name, label, value) {
  return (
    '<div class="pl-min-field"><label>' +
    escapeHtml(label) +
    '</label><input type="number" min="0" max="360" step="5" data-plan-min="' +
    name +
    '" value="' +
    (Number(value) || 0) +
    '" /></div>'
  );
}

function renderSetupCard(first) {
  const st = planSettings();
  const mode = st.mode || "split";
  const m = st.minutesByWeekday;
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  let html = '<div class="pl-setup" id="plan-setup" data-mode="' + mode + '">';
  html += '<div class="pl-setup-head">' + (first ? "How much time can you give revision?" : "Planner settings") + "</div>";
  html +=
    '<div class="pl-setup-note">Rest days are fine \u2014 set a day to 0 and nothing will ever be scheduled on it.</div>';
  html += '<div class="pl-mode-row">';
  [
    ["same", "Same every day"],
    ["split", "Weekdays &amp; weekends"],
    ["custom", "Each day different"]
  ].forEach((o) => {
    html +=
      '<button class="pl-mode' + (mode === o[0] ? " is-on" : "") + '" data-plan-mode="' + o[0] + '">' + o[1] + "</button>";
  });
  html += "</div>";

  html += '<div class="pl-mins">';
  if (mode === "same") {
    html += minsField("every", "Minutes a day", m[1] || 45);
  } else if (mode === "custom") {
    for (let i = 0; i < 7; i++) html += minsField("d" + i, dayNames[i], m[i]);
  } else {
    html += minsField("weekday", "Weekdays", m[1] || 45);
    html += minsField("weekend", "Weekends", m[0] || 60);
  }
  html += "</div>";

  html +=
    '<label class="pl-check"><input type="checkbox" id="plan-auto-tests"' +
    (st.autoScheduleTests ? " checked" : "") +
    " /> Schedule mock papers for me (1\u20132 a week as exams get close). A paper always gets its real exam time, and nothing else is scheduled that day.</label>";
  html +=
    '<label class="pl-check"><input type="checkbox" id="plan-narrow"' +
    (st.narrowScope ? " checked" : "") +
    " /> Narrow the scope: one pass fewer per topic and no reading tasks, for when time is short.</label>";
  html +=
    '<div class="pl-setup-actions">' +
    (first ? "" : '<button class="pl-btn-quiet" data-plan-act="settings-cancel">Cancel</button>') +
    '<button class="pl-btn" data-plan-act="save-setup">' +
    (first ? "Build my plan" : "Save and re-plan") +
    "</button></div>";
  html += "</div>";
  return html;
}

/* ---------- today: one focused card, then the rest on request ---------- */

function todayHeader() {
  const key = todayKey();
  return (
    '<div class="today-section-label">Today<span class="label-note">' +
    formatDateHuman(key) +
    '</span><button class="pl-inline-btn" data-plan-act="replan" title="Rebuild the schedule from scratch">' +
    ui("refresh", 12) +
    'Re-plan</button><button class="pl-inline-btn" data-plan-act="settings">' +
    ui("dots", 12) +
    "Time per day</button></div>"
  );
}

/* The one card that matters: the next thing to do, with one obvious button. */
function renderFocusCard(dateKey, t) {
  return (
    '<div class="pl-focus kind-' +
    t.kind +
    '"><div class="pl-focus-top"><span class="pl-focus-eyebrow">' +
    iconImg(KIND_ICON[t.kind] || "page", 15) +
    "<span>Next up \u00b7 " +
    escapeHtml(KIND_LABEL[t.kind] || t.kind) +
    (t.fullPaper ? " \u00b7 full paper" : "") +
    '</span></span><span class="pl-focus-mins">' +
    (t.minutes || 0) +
    ' min</span></div><div class="pl-focus-title">' +
    escapeHtml(t.title) +
    '</div><div class="pl-focus-sub">' +
    (t.subjectTitle ? escapeHtml(t.subjectTitle) + " \u00b7 " : "") +
    escapeHtml(t.why || "") +
    (t.carriedFrom ? " \u00b7 carried over" : "") +
    (t.pulledFrom ? " \u00b7 pulled forward" : "") +
    '</div><div class="pl-focus-actions"><button class="pl-btn" data-plan-task="' +
    t.id +
    '" data-kind="' +
    t.kind +
    '" data-page-id="' +
    t.pageId +
    '" data-full="' +
    (t.fullPaper ? "1" : "") +
    '" data-date="' +
    dateKey +
    '">' +
    escapeHtml(KIND_ACTION[t.kind] || "Open") +
    ui("arrowRight", 13) +
    '</button><button class="pl-btn-quiet" data-plan-tick="' +
    t.id +
    '" data-date="' +
    dateKey +
    '" data-minutes="' +
    (t.minutes || 0) +
    '">Mark done</button><button class="pl-focus-skip" data-plan-skip="' +
    t.id +
    '" data-date="' +
    dateKey +
    '">' +
    (t.pulledFrom ? "Put it back" : "Not today") +
    "</button></div></div>"
  );
}

/* One quiet line summarising what follows, expandable into the full list. */
function renderThenLine(rest, total) {
  if (!rest.length) return "";
  const names = rest
    .slice(0, 2)
    .map((t) => (KIND_SHORT[t.kind] || t.kind) + " \u00b7 " + escapeHtml(shorten(t.title, 22)))
    .join(", ");
  const more = rest.length > 2 ? ", +" + (rest.length - 2) + " more" : "";
  return (
    '<button class="pl-then" data-plan-act="showall">' +
    (listOpen ? ui("chevron", 12) : ui("chevronRight", 12)) +
    "<span>" +
    (listOpen ? "Then" : "Then: " + names + more) +
    "</span>" +
    '<span class="pl-then-count">' +
    total +
    " today</span></button>"
  );
}

function renderTaskRow(dateKey, t) {
  const done = isTaskDone(dateKey, t.id);
  const skipped = isTaskSkipped(dateKey, t.id);
  const open = expandedId === t.id;
  return (
    '<div class="pl-task kind-' +
    t.kind +
    (done ? " is-done" : "") +
    (skipped ? " is-skipped" : "") +
    (open ? " is-open" : "") +
    '">' +
    '<button class="pl-tick" data-plan-tick="' +
    t.id +
    '" data-date="' +
    dateKey +
    '" data-minutes="' +
    (t.minutes || 0) +
    '" title="' +
    (done ? "Mark as not done" : "Mark as done") +
    '">' +
    (done ? ui("check", 13, 2.6) : "") +
    "</button>" +
    '<div class="pl-kind" title="' +
    escapeHtml(KIND_LABEL[t.kind] || t.kind) +
    '">' +
    iconImg(KIND_ICON[t.kind] || "page", 18) +
    "</div>" +
    '<button class="pl-info" data-plan-expand="' +
    t.id +
    '" title="Why this task?"><span class="pl-title">' +
    escapeHtml(t.title) +
    (t.carriedFrom ? '<span class="pl-flag">carried over</span>' : "") +
    (t.pulledFrom ? '<span class="pl-flag is-early">pulled forward</span>' : "") +
    (t.fullPaper ? '<span class="pl-flag is-paper">full paper</span>' : "") +
    '</span><span class="pl-why"><span class="pl-kind-label">' +
    escapeHtml(KIND_LABEL[t.kind] || t.kind) +
    "</span>" +
    (t.subjectTitle ? " \u00b7 " + escapeHtml(t.subjectTitle) : "") +
    (t.why ? " \u00b7 " + escapeHtml(t.why) : "") +
    "</span></button>" +
    '<div class="pl-mins-tag">' +
    (t.minutes || 0) +
    " min</div>" +
    '<button class="pl-go" data-plan-task="' +
    t.id +
    '" data-kind="' +
    t.kind +
    '" data-page-id="' +
    t.pageId +
    '" data-full="' +
    (t.fullPaper ? "1" : "") +
    '" data-date="' +
    dateKey +
    '">' +
    escapeHtml(KIND_ACTION[t.kind] || "Open") +
    ui("arrowRight", 13) +
    "</button>" +
    '<button class="pl-skip" data-plan-skip="' +
    t.id +
    '" data-date="' +
    dateKey +
    '" title="' +
    (t.pulledFrom ? "Put it back" : "Not today") +
    '">' +
    ui("close", 12, 2.2) +
    "</button></div>"
  );
}

function renderTodayFocus() {
  const key = todayKey();
  const tasks = todayTasks();
  const cap = capacityOn(key);
  let html = todayHeader();

  if (!cap) {
    return (
      html +
      '<div class="plan-empty"><p>Today is a rest day, so nothing is scheduled \u2014 that is deliberate.</p></div>' +
      renderPullRow()
    );
  }
  if (!tasks.length) {
    return (
      html +
      '<div class="plan-empty"><div class="plan-empty-icon">' +
      iconImg(allCards().length ? "check" : "bulb", 34) +
      "</div><p>" +
      (topicUnits().length
        ? "Nothing is scheduled today. Add exam dates to your subjects and the planner will fill the run-up for you."
        : "Write some notes on a topic page and the planner will start scheduling quizzes and papers on it.") +
      "</p></div>" +
      renderPullRow()
    );
  }

  const left = outstanding(key, tasks);
  const doneMins = minutesDone(key);

  /* Finishing the day should feel like finishing, not like more admin. */
  if (!left.length) {
    const subjects = {};
    tasks.forEach((t) => (subjects[t.subjectId || t.pageId] = true));
    const n = Object.keys(subjects).length;
    html +=
      '<div class="pl-done-card"><div class="pl-done-icon">' +
      ui("check", 22, 2.6) +
      '</div><div class="pl-done-text"><strong>Done for today.</strong><span>' +
      doneMins +
      " minutes across " +
      n +
      " subject" +
      (n === 1 ? "" : "s") +
      ". Tomorrow is already planned.</span></div></div>";
    html += renderPullRow();
    html += renderThenLine([], tasks.length);
    if (listOpen) {
      html += '<div class="pl-list">';
      tasks.forEach((t) => {
        html += renderTaskRow(key, t);
      });
      html += "</div>";
    }
    return html;
  }

  const focus = left[0];
  const rest = left.slice(1);
  const paperDay = tasks.some((t) => t.kind === "test");

  html += renderFocusCard(key, focus);
  const pct = cap ? Math.min(100, Math.round((doneMins / cap) * 100)) : 0;
  html +=
    '<div class="pl-progress"><div class="pl-progress-bar"><div class="pl-progress-fill" style="width:' +
    pct +
    '%"></div></div><div class="pl-progress-text">' +
    doneMins +
    " of " +
    cap +
    " min" +
    (paperDay ? " \u00b7 a mock paper runs to its real exam time, so today is just the paper" : "") +
    "</div></div>";
  html += renderThenLine(rest, tasks.length);
  if (listOpen) {
    html += '<div class="pl-list">';
    tasks.forEach((t) => {
      html += renderTaskRow(key, t);
    });
    html += "</div>";
  }
  html += renderPullRow();
  return html;
}

/* Bringing tomorrow's work forward is always opt-in: the button is offered,
   never applied for you. */
function renderPullRow() {
  const key = todayKey();
  const tasks = todayTasks();
  const left = outstanding(key, tasks).length;
  const next = pullPreview();
  if (!next) return "";
  if (left) {
    // Never nag mid-session: offered quietly, one line, no card.
    return (
      '<button class="pl-pull-quiet" data-plan-act="pull">' +
      ui("plus", 12) +
      "Get ahead: pull " +
      escapeHtml(shorten(next.title, 26)) +
      " (" +
      next.minutes +
      " min) forward</button>"
    );
  }
  return (
    '<div class="pl-pull"><div class="pl-pull-text"><strong>Want to get ahead?</strong><span>Next up is ' +
    escapeHtml(next.title) +
    " \u00b7 " +
    escapeHtml((KIND_LABEL[next.kind] || next.kind).toLowerCase()) +
    " \u00b7 " +
    next.minutes +
    " min, scheduled for " +
    escapeHtml(formatDateHuman(next.date)) +
    '.</span></div><button class="pl-btn-quiet" data-plan-act="pull">Pull it forward</button></div>'
  );
}

/* ---------- one week chart: planned and done in the same bars ---------- */

function renderWeekStrip() {
  const week = weekOverview();
  const reviewed = weeklyCounts(7).reduce((s, d) => s + d.count, 0);
  const maxPlanned = Math.max.apply(
    null,
    week.map((d) => Math.max(d.planned, d.done, d.capacity || 0)).concat([1])
  );
  const note =
    "planned vs done" +
    (reviewed ? " \u00b7 " + reviewed + " cards reviewed" : "") +
    (reviewedToday() ? " \u00b7 " + reviewedToday() + " today" : "");

  let html =
    '<div class="today-section-label">This week<span class="label-note">' +
    escapeHtml(note) +
    '</span><button class="pl-inline-btn" data-plan-act="timeline">' +
    (timelineOpen ? "Hide the next 14 days" : "See the next 14 days") +
    "</button></div>";
  html += '<div class="pl-week">';
  week.forEach((d) => {
    const plannedPct = Math.round((Math.max(d.planned, d.done) / maxPlanned) * 100);
    const donePct = d.planned || d.done ? Math.min(100, Math.round((d.done / Math.max(d.planned, d.done, 1)) * 100)) : 0;
    html +=
      '<button class="pl-week-col' +
      (d.isToday ? " is-today" : "") +
      (d.capacity ? "" : " is-rest") +
      '" data-plan-day="' +
      d.date +
      '" title="' +
      escapeHtml(formatDateHuman(d.date)) +
      ": " +
      d.planned +
      " min planned, " +
      d.done +
      ' min done"><div class="pl-week-bar"><div class="pl-week-plan" style="height:' +
      plannedPct +
      '%"><div class="pl-week-done" style="height:' +
      donePct +
      '%"></div></div></div><div class="pl-week-mins">' +
      (d.capacity ? d.planned : "\u2014") +
      '</div><div class="pl-week-day">' +
      WEEKDAYS[d.weekday] +
      "</div></button>";
  });
  html += "</div>";
  return html;
}

/* ---------- the next fortnight (closed unless asked for) ---------- */

function renderTimeline() {
  if (!timelineOpen) return "";
  const days = upcomingDays(14);
  if (!days.length) return '<div class="pl-timeline-empty">Nothing else is scheduled yet.</div>';
  let html = '<div class="pl-timeline">';
  days.forEach((d) => {
    html +=
      '<div class="pl-tl-day"><div class="pl-tl-date">' +
      escapeHtml(formatDateHuman(d.date)) +
      '</div><div class="pl-tl-tasks">' +
      d.tasks
        .map(
          (t) =>
            '<button class="pl-tl-task kind-' +
            t.kind +
            '" data-plan-open="' +
            t.pageId +
            '"><span class="pl-tl-kind">' +
            escapeHtml(KIND_LABEL[t.kind] || t.kind) +
            "</span>" +
            escapeHtml(t.title) +
            '<span class="pl-tl-mins">' +
            t.minutes +
            "m</span></button>"
        )
        .join("") +
      "</div></div>";
  });
  html += "</div>";
  return html;
}

/* ---------- everything analytical, folded away ---------- */

function renderProgressSection() {
  const standing = subjectStanding();
  let html =
    '<button class="pl-section-toggle' +
    (progressOpen ? " is-open" : "") +
    '" data-plan-act="progress">' +
    (progressOpen ? ui("chevron", 13) : ui("chevronRight", 13)) +
    "<span>Where you stand</span>" +
    '<span class="pl-section-note">' +
    escapeHtml(standingSummary(standing) || "nothing recorded yet") +
    "</span></button>";
  if (!progressOpen) return html;

  html += '<div class="pl-progress-panel">';
  html += renderStanding(standing);
  html += renderFeedbackSection({ title: "Exam feedback to act on", limit: 6 });
  html += renderWorkSection(null, { title: "Marked work" });
  html += "</div>";
  return html;
}

/*
 * One card per subject, and only one.
 *
 * Readiness, the grade estimate, the direction of travel, where the marks are
 * going and which topics are the problem all used to be four separate lists
 * saying overlapping things. They are one card now: a student should be able to
 * answer "how am I doing in History" without reading four of anything.
 */
const CONFIDENCE_LABEL = { low: "low confidence", medium: "fair confidence", high: "good confidence" };

function examWhen(days) {
  if (days === null || days === undefined) return "no exam date";
  if (days <= 0) return "exam today";
  if (days === 1) return "exam tomorrow";
  if (days < 21) return "exam in " + days + " days";
  const weeks = Math.round(days / 7);
  return "exam in " + weeks + " weeks";
}

function standingChip(w) {
  const label = escapeHtml(w.title) + '<span class="pl-chip-why">' + escapeHtml(w.reason) + "</span>";
  if (w.action === "open") return '<button class="pl-chip" data-plan-open="' + w.pageId + '">' + label + "</button>";
  return '<button class="pl-chip" data-plan-act="' + w.action + '" data-page-id="' + w.pageId + '">' + label + "</button>";
}

function renderStanding(rows) {
  const list = rows || subjectStanding();
  if (!list.length) return "";

  let html = '<div class="pl-ready-list">';
  list.forEach((s) => {
    html +=
      '<div class="pl-ready"><div class="pl-ready-top">' +
      '<button class="pl-ready-title" data-plan-open="' +
      s.id +
      '">' +
      escapeHtml(s.title) +
      "</button>" +
      '<div class="pl-ready-when">' +
      escapeHtml(examWhen(s.examDays)) +
      "</div></div>";

    html += '<div class="pl-grade">';
    if (s.grade) {
      html += '<span class="pl-grade-badge">Grade ' + escapeHtml(s.grade) + "</span>";
      html +=
        '<span class="pl-grade-note">' +
        escapeHtml(CONFIDENCE_LABEL[s.confidence] || "") +
        " \u00b7 " +
        escapeHtml(s.confidenceNote) +
        "</span>";
    } else {
      html += '<span class="pl-grade-note">Nothing marked yet \u2014 one quiz and an estimate appears here.</span>';
    }
    if (s.trend && s.trend.dir !== "flat") {
      html +=
        '<span class="pl-trend ' +
        (s.trend.dir === "up" ? "is-up" : "is-down") +
        '">' +
        (s.trend.dir === "up" ? "\u2191" : "\u2193") +
        " " +
        Math.abs(s.trend.delta) +
        " pts</span>";
    }
    html += "</div>";

    html +=
      '<div class="pl-ready-bar"><div class="pl-ready-fill" style="width:' +
      s.readinessPct +
      '%"></div></div>';
    html +=
      '<div class="pl-ready-foot"><span>' +
      s.readinessPct +
      "% ready</span>" +
      (s.loss ? "<span>" + escapeHtml(s.loss.text) + "</span>" : "") +
      "</div>";

    if (s.weak.length) {
      html +=
        '<div class="pl-chips">' +
        s.weak.slice(0, 4).map(standingChip).join("") +
        (s.weak.length > 4 ? '<span class="pl-chip is-quiet">+' + (s.weak.length - 4) + " more</span>" : "") +
        "</div>";
    }
    html += "</div>";
  });
  html += "</div>";
  return html;
}
