/*
 * The Plan view: a dated revision schedule that works backwards from your
 * exams. Replaces the old Today page.
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
  shakyPages,
  coverageGaps,
  todayKey
} from "../srs.js";
import { topicUnits, readiness } from "../plan/engine.js";
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
  health
} from "../plan/store.js";
import { renderFeedbackSection, renderAttemptsSection, renderQuizzesSection } from "./insights.js";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const KIND_LABEL = {
  due: "Flashcards due",
  cards: "Flashcards",
  quiz: "Quiz me",
  test: "Mock paper",
  read: "Learn it",
  final: "Final review"
};
const KIND_ICON = { due: "cards", cards: "cards", quiz: "question", test: "exam", read: "notebook", final: "target" };
const KIND_ACTION = { due: "Start", cards: "Start", quiz: "Quiz me", test: "Sit it", read: "Open", final: "Start" };

/* View-local UI state. Deliberately not persisted. */
let settingsOpen = false;
let timelineOpen = false;

export function togglePlanSettings(force) {
  settingsOpen = force === undefined ? !settingsOpen : !!force;
}

export function togglePlanTimeline() {
  timelineOpen = !timelineOpen;
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

  html += '<div class="today-sub">' + statusLine() + "</div>";
  html += renderStrip();
  if (settingsOpen) html += renderSetupCard(false);
  html += renderToday();
  html += renderWeekStrip();
  html += renderReadiness();
  html += renderTimeline();
  html += '<div class="today-section-label">Evidence behind the plan</div>';
  html += renderFeedbackSection({ title: "Exam feedback to act on", limit: 6 });
  html += renderQuizzesSection(null);
  html += renderAttemptsSection(null);
  html += renderShaky();
  html += renderGaps();
  html += renderWeekGraph();
  return html;
}

/* ---------- status ---------- */

function statusLine() {
  const key = todayKey();
  const h = health();
  const next = computeNextExam();
  const tasks = todayTasks();
  const left = tasks.filter((t) => !isTaskDone(key, t.id) && !isTaskSkipped(key, t.id));
  const mins = left.reduce((s, t) => s + (t.minutes || 0), 0);

  if (h.behind) {
    return (
      "Behind by about " +
      h.droppedMinutes +
      " minutes of work \u2014 " +
      h.droppedCount +
      " task" +
      (h.droppedCount === 1 ? "" : "s") +
      " would not fit before your exams. Add time per day, or leave it and the weakest topics keep the time."
    );
  }
  if (!tasks.length) return "Nothing scheduled today. Tomorrow is already planned.";
  if (!left.length) return "Everything for today is done.";
  const tail = next
    ? next.days === 0
      ? " \u00b7 " + escapeHtml(next.name) + " is today"
      : " \u00b7 " + escapeHtml(next.name) + " in " + next.days + " day" + (next.days === 1 ? "" : "s")
    : "";
  return "About " + mins + " minutes today across " + left.length + " task" + (left.length === 1 ? "" : "s") + tail;
}

function statCard(icon, value, label, tone) {
  return (
    '<div class="stat-card' +
    (tone ? " tone-" + tone : "") +
    '"><div class="stat-icon">' +
    icon +
    '</div><div class="stat-value">' +
    escapeHtml(String(value)) +
    '</div><div class="stat-label">' +
    escapeHtml(label) +
    "</div></div>"
  );
}

function renderStrip() {
  const key = todayKey();
  const done = minutesDone(key);
  const cap = capacityOn(key);
  const due = countDueEverywhere();
  const next = computeNextExam();
  const units = topicUnits();
  let avg = 0;
  units.forEach((u) => (avg += readiness(u)));
  avg = units.length ? Math.round((avg / units.length) * 100) : 0;

  let html = '<div class="today-strip">';
  html += statCard(ui("stopwatch", 15), done + "/" + (cap || 0), "minutes today", done > 0 ? "good" : "");
  html += statCard(ui("flashcard", 15), String(due), "cards due", due > 0 ? "accent" : "");
  html += statCard(
    ui("calendar", 15),
    next ? (next.days === 0 ? "Today" : next.days + "d") : "\u2014",
    next ? "to " + shorten(next.name, 20) : "no exams set",
    next && next.days <= 7 ? "urgent" : ""
  );
  html += statCard(
    ui("chart", 15),
    units.length ? avg + "%" : "\u2014",
    "average readiness",
    avg >= 70 ? "good" : avg < 40 ? "urgent" : ""
  );
  html += "</div>";
  return html;
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
    '<div class="pl-setup-actions">' +
    (first ? "" : '<button class="pl-btn-quiet" data-plan-act="settings-cancel">Cancel</button>') +
    '<button class="pl-btn" data-plan-act="save-setup">' +
    (first ? "Build my plan" : "Save and re-plan") +
    "</button></div>";
  html += "</div>";
  return html;
}

/* ---------- today ---------- */

function renderTaskRow(dateKey, t) {
  const done = isTaskDone(dateKey, t.id);
  const skipped = isTaskSkipped(dateKey, t.id);
  return (
    '<div class="pl-task kind-' +
    t.kind +
    (done ? " is-done" : "") +
    (skipped ? " is-skipped" : "") +
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
    '<div class="pl-info"><div class="pl-title">' +
    escapeHtml(t.title) +
    (t.carriedFrom ? '<span class="pl-flag">carried over</span>' : "") +
    (t.pulledFrom ? '<span class="pl-flag is-early">pulled forward</span>' : "") +
    (t.fullPaper ? '<span class="pl-flag is-paper">full paper</span>' : "") +
    '</div><div class="pl-why"><span class="pl-kind-label">' +
    escapeHtml(KIND_LABEL[t.kind] || t.kind) +
    "</span>" +
    (t.subjectTitle ? " \u00b7 " + escapeHtml(t.subjectTitle) : "") +
    (t.why ? " \u00b7 " + escapeHtml(t.why) : "") +
    "</div></div>" +
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

function renderToday() {
  const key = todayKey();
  const tasks = todayTasks();
  const cap = capacityOn(key);

  let html =
    '<div class="today-section-label">Today<span class="label-note">' +
    formatDateHuman(key) +
    '</span><button class="pl-inline-btn" data-plan-act="replan" title="Rebuild the schedule from scratch">' +
    ui("refresh", 12) +
    'Re-plan</button><button class="pl-inline-btn" data-plan-act="settings">' +
    ui("dots", 12) +
    "Time per day</button></div>";

  if (!cap) {
    html +=
      '<div class="plan-empty"><p>Today is a rest day, so nothing is scheduled \u2014 that is deliberate.</p></div>' +
      renderPullRow();
    return html;
  }
  if (!tasks.length) {
    html +=
      '<div class="plan-empty"><div class="plan-empty-icon">' +
      iconImg(allCards().length ? "check" : "bulb", 34) +
      "</div><p>" +
      (topicUnits().length
        ? "Nothing is scheduled today. Add exam dates to your subjects and the planner will fill the run-up for you."
        : "Write some notes on a topic page and the planner will start scheduling quizzes and papers on it.") +
      "</p></div>" +
      renderPullRow();
    return html;
  }

  const doneMins = minutesDone(key);
  const pct = cap ? Math.min(100, Math.round((doneMins / cap) * 100)) : 0;
  const paperDay = tasks.some((t) => t.kind === "test");
  html +=
    '<div class="pl-progress"><div class="pl-progress-bar"><div class="pl-progress-fill" style="width:' +
    pct +
    '%"></div></div><div class="pl-progress-text">' +
    doneMins +
    " of " +
    cap +
    " minutes done" +
    (paperDay ? " \u00b7 a mock paper runs to its real exam time, so today is just the paper" : "") +
    "</div></div>";

  html += '<div class="pl-list">';
  tasks.forEach((t) => {
    html += renderTaskRow(key, t);
  });
  html += "</div>";
  html += renderPullRow();
  return html;
}

/* Bringing tomorrow's work forward is always opt-in: the button is offered,
   never applied for you. */
function renderPullRow() {
  const key = todayKey();
  const tasks = todayTasks();
  const outstanding = tasks.filter((t) => !isTaskDone(key, t.id) && !isTaskSkipped(key, t.id)).length;
  const next = pullPreview();
  if (!next) return "";
  return (
    '<div class="pl-pull' +
    (outstanding ? " is-quiet" : "") +
    '"><div class="pl-pull-text"><strong>' +
    (outstanding ? "Want to get ahead?" : "Done for today.") +
    "</strong><span>Next up is " +
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

/* ---------- week strip ---------- */

function renderWeekStrip() {
  const week = weekOverview();
  let html = '<div class="today-section-label">This week<span class="label-note">planned minutes</span></div>';
  html += '<div class="pl-week">';
  week.forEach((d) => {
    const pct = d.planned ? Math.min(100, Math.round((d.done / Math.max(d.planned, d.capacity || 1)) * 100)) : 0;
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
      ' min planned"><div class="pl-week-bar"><div class="pl-week-fill" style="height:' +
      pct +
      '%"></div></div><div class="pl-week-mins">' +
      (d.capacity ? d.planned : "\u2014") +
      '</div><div class="pl-week-day">' +
      WEEKDAYS[d.weekday] +
      "</div></button>";
  });
  html += "</div>";
  return html;
}

/* ---------- readiness by subject ---------- */

function renderReadiness() {
  const units = topicUnits();
  if (!units.length) return "";
  const groups = {};
  units.forEach((u) => {
    const g =
      groups[u.subjectId] ||
      (groups[u.subjectId] = {
        id: u.subjectId,
        title: u.subjectTitle || u.title,
        examDays: u.examDays,
        sum: 0,
        n: 0,
        weak: []
      });
    const r = readiness(u);
    g.sum += r;
    g.n += 1;
    if (r < 0.4) g.weak.push({ title: u.title, pageId: u.pageId, r: r });
  });
  const rows = Object.keys(groups)
    .map((k) => groups[k])
    .sort((a, b) => {
      const ea = a.examDays === null ? Infinity : a.examDays;
      const eb = b.examDays === null ? Infinity : b.examDays;
      return ea - eb;
    });

  let html = '<div class="today-section-label">Readiness<span class="label-note">tested, remembered, recent</span></div>';
  html += '<div class="pl-ready-list">';
  rows.forEach((g) => {
    const pct = Math.round((g.sum / g.n) * 100);
    g.weak.sort((a, b) => a.r - b.r);
    html +=
      '<div class="pl-ready"><div class="pl-ready-top"><button class="pl-ready-title" data-plan-open="' +
      g.id +
      '">' +
      escapeHtml(g.title) +
      '</button><div class="pl-ready-when">' +
      (g.examDays === null
        ? "no exam date"
        : g.examDays === 0
          ? "exam today"
          : "exam in " + g.examDays + " day" + (g.examDays === 1 ? "" : "s")) +
      '</div><div class="pl-ready-pct">' +
      pct +
      '%</div></div><div class="pl-ready-bar"><div class="pl-ready-fill" style="width:' +
      pct +
      '%"></div></div>' +
      (g.weak.length
        ? '<div class="pl-chips">' +
          g.weak
            .slice(0, 4)
            .map((w) => '<button class="pl-chip" data-plan-open="' + w.pageId + '">' + escapeHtml(w.title) + "</button>")
            .join("") +
          "</div>"
        : "") +
      "</div>";
  });
  html += "</div>";
  return html;
}

/* ---------- the next fortnight ---------- */

function renderTimeline() {
  const days = upcomingDays(14);
  if (!days.length) return "";
  let html =
    '<div class="today-section-label">What is coming<span class="label-note">' +
    days.length +
    " planned day" +
    (days.length === 1 ? "" : "s") +
    '</span><button class="pl-inline-btn" data-plan-act="timeline">' +
    (timelineOpen ? "Hide" : "Show") +
    "</button></div>";
  if (!timelineOpen) return html;
  html += '<div class="pl-timeline">';
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

/* ---------- evidence sections ---------- */

function renderShaky() {
  const rows = shakyPages(5);
  if (rows.length === 0) return "";
  let html =
    '<div class="today-section-label">Shaky topics<span class="label-note">where you slip most often</span></div>';
  html += '<div class="shaky-list">';
  rows.forEach((r) => {
    const pct = Math.round(r.rate * 100);
    html +=
      '<button class="shaky-row" data-plan-act="revise" data-page-id="' +
      r.pageId +
      '"><div class="plan-icon">' +
      iconImg(r.icon, 18) +
      '</div><div class="plan-info"><div class="plan-title">' +
      escapeHtml(r.title) +
      '</div><div class="plan-detail">' +
      (r.subjectTitle ? escapeHtml(r.subjectTitle) + " \u00b7 " : "") +
      r.cards +
      " card" +
      (r.cards === 1 ? "" : "s") +
      '</div></div><div class="shaky-meter"><div class="shaky-fill" style="width:' +
      Math.min(100, pct) +
      '%"></div></div><div class="shaky-pct">' +
      pct +
      "%</div></button>";
  });
  html += "</div>";
  return html;
}

function renderGaps() {
  const rows = coverageGaps(30, 5);
  if (rows.length === 0) return "";
  let html =
    '<div class="today-section-label">Never tested<span class="label-note">no quiz, no paper, no cards</span></div>';
  html += '<div class="gap-list">';
  rows.forEach((r) => {
    html +=
      '<button class="gap-row" data-plan-act="quiz" data-page-id="' +
      r.pageId +
      '"><div class="plan-icon">' +
      iconImg(r.icon, 18) +
      '</div><div class="plan-info"><div class="plan-title">' +
      escapeHtml(r.title) +
      '</div><div class="plan-detail">' +
      (r.subjectTitle ? escapeHtml(r.subjectTitle) + " \u00b7 " : "") +
      "exam in " +
      r.examDays +
      " day" +
      (r.examDays === 1 ? "" : "s") +
      " \u00b7 quiz it and the flashcards write themselves" +
      '</div></div><div class="plan-go">' +
      ui("arrowRight", 15) +
      "</div></button>";
  });
  html += "</div>";
  return html;
}

function renderWeekGraph() {
  const week = weeklyCounts(7);
  const max = Math.max.apply(null, week.map((d) => d.count).concat([1]));
  const total = week.reduce((s, d) => s + d.count, 0);
  const streak = currentStreak();
  let html =
    '<div class="today-section-label">Cards reviewed<span class="label-note">' +
    total +
    " this week" +
    (streak > 0 ? " \u00b7 " + streak + " day streak" : "") +
    " \u00b7 " +
    reviewedToday() +
    " today</span></div>";
  html += '<div class="week-graph">';
  week.forEach((d) => {
    const day = new Date(d.date + "T00:00:00");
    const height = d.count === 0 ? 3 : Math.max(6, Math.round((d.count / max) * 56));
    html +=
      '<div class="week-col' +
      (d.isToday ? " is-today" : "") +
      '" title="' +
      escapeHtml(formatDateHuman(d.date)) +
      ": " +
      d.count +
      ' reviewed"><div class="week-bar-wrap"><div class="week-bar" style="height:' +
      height +
      'px"></div></div><div class="week-count">' +
      (d.count || "") +
      '</div><div class="week-day">' +
      WEEKDAYS[day.getDay()] +
      "</div></div>";
  });
  html += "</div>";
  return html;
}
