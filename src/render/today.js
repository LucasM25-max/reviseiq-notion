// The "Today" dashboard: what to actually do right now.
//
// Everything here is derived from data already in the workspace (flashcard
// scheduling, lapse history, exam dates), so it never invents work. When there
// is nothing due, it says so instead of manufacturing filler tasks.
import { escapeHtml, formatDateHuman } from "../utils.js";
import { computeNextExam } from "../exams.js";
import { iconImg, ui } from "../icons.js";
import {
  buildTodayPlan,
  shakyPages,
  coverageGaps,
  countDueEverywhere,
  currentStreak,
  weeklyCounts,
  reviewedToday,
  allCards
} from "../srs.js";
import { renderFeedbackSection, renderAttemptsSection } from "./insights.js";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export function renderTodayView() {
  const plan = buildTodayPlan(4);
  const due = countDueEverywhere();
  const total = allCards().length;

  let html =
    '<div class="breadcrumbs"><span class="crumb current">' +
    iconImg("target", 14) +
    '<span class="crumb-text">Today</span></span></div>';
  html +=
    '<div class="page-header"><div class="page-title">' +
    escapeHtml(greeting()) +
    "</div></div>";
  html += '<div class="today-sub">' + escapeHtml(todayLine(due, total)) + "</div>";

  html += renderStrip();
  html += renderPlan(plan, total);
  // Examiner feedback outlives the results screen: it lives here until ticked off.
  html += renderFeedbackSection({ title: "Exam feedback to act on", limit: 6 });
  html += renderAttemptsSection(null);
  html += renderShaky();
  html += renderGaps();
  html += renderWeek();

  return html;
}

function todayLine(due, total) {
  if (total === 0) return "Turn your notes into flashcards and this page will tell you what to revise each day.";
  if (due === 0) return "Nothing is due today.";
  return due + " flashcard" + (due === 1 ? "" : "s") + " waiting for you.";
}

/* ---------- top strip: due, streak, next exam ---------- */

function renderStrip() {
  const due = countDueEverywhere();
  const streak = currentStreak();
  const next = computeNextExam();
  const doneToday = reviewedToday();

  let html = '<div class="today-strip">';
  html += statCard(ui("flashcard", 15), String(due), "due today", due > 0 ? "accent" : "");
  html += statCard(
    ui("flame", 15),
    streak > 0 ? streak + " day" + (streak === 1 ? "" : "s") : "\u2014",
    streak > 0 ? "streak" : "no streak yet",
    streak >= 3 ? "warm" : ""
  );
  html += statCard(ui("check", 15), String(doneToday), "reviewed today", doneToday > 0 ? "good" : "");
  html += statCard(
    ui("calendar", 15),
    next ? (next.days === 0 ? "Today" : next.days + "d") : "\u2014",
    next ? "to " + shorten(next.name, 22) : "no exams set",
    next && next.days <= 7 ? "urgent" : ""
  );
  html += "</div>";
  return html;
}

function statCard(icon, value, label, tone) {
  return (
    '<div class="stat-card' +
    (tone ? " tone-" + tone : "") +
    '"><div class="stat-icon">' +
    icon +
    '</div><div class="stat-value">' +
    escapeHtml(value) +
    '</div><div class="stat-label">' +
    escapeHtml(label) +
    "</div></div>"
  );
}

function shorten(s, n) {
  const t = String(s || "");
  return t.length > n ? t.slice(0, n - 1) + "\u2026" : t;
}

/* ---------- the plan ---------- */

function renderPlan(plan, totalCards) {
  let html = '<div class="today-section-label">Your plan</div>';

  if (plan.length === 0) {
    const message =
      totalCards === 0
        ? "No flashcards yet. Add a Flashcard block to any page \u2014 question on the front, answer hidden inside \u2014 and it will start showing up here."
        : "You\u2019re up to date. Nothing is due and nothing looks shaky, so go and do something else \u2014 come back tomorrow.";
    html +=
      '<div class="plan-empty">' +
      '<div class="plan-empty-icon">' +
      iconImg(totalCards === 0 ? "bulb" : "check", 34) +
      "</div><p>" +
      escapeHtml(message) +
      "</p></div>";
    return html;
  }

  const totalMinutes = plan.reduce((sum, p) => sum + p.minutes, 0);
  html +=
    '<div class="plan-total">About ' +
    totalMinutes +
    " minutes in " +
    plan.length +
    " block" +
    (plan.length === 1 ? "" : "s") +
    "</div>";

  html += '<div class="plan-list">';
  plan.forEach((item, i) => {
    const isOpen = item.kind === "gap";
    html +=
      '<button class="plan-row kind-' +
      item.kind +
      '" data-plan-act="' +
      (isOpen ? "open" : "revise") +
      '" data-page-id="' +
      item.pageId +
      '">' +
      '<div class="plan-rank">' +
      (i + 1) +
      "</div>" +
      '<div class="plan-icon">' +
      iconImg(item.icon, 20) +
      "</div>" +
      '<div class="plan-info"><div class="plan-title">' +
      escapeHtml(item.title) +
      '</div><div class="plan-detail">' +
      escapeHtml(item.detail) +
      "</div></div>" +
      '<div class="plan-minutes">' +
      item.minutes +
      " min</div>" +
      '<div class="plan-go">' +
      ui(isOpen ? "arrowRight" : "flashcard", 15) +
      "</div>" +
      "</button>";
  });
  html += "</div>";
  return html;
}

/* ---------- shaky topics ---------- */

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
      '">' +
      '<div class="plan-icon">' +
      iconImg(r.icon, 18) +
      "</div>" +
      '<div class="plan-info"><div class="plan-title">' +
      escapeHtml(r.title) +
      '</div><div class="plan-detail">' +
      (r.subjectTitle ? escapeHtml(r.subjectTitle) + " \u00B7 " : "") +
      r.cards +
      " card" +
      (r.cards === 1 ? "" : "s") +
      "</div></div>" +
      '<div class="shaky-meter" title="' +
      pct +
      '% of reviews forgotten"><div class="shaky-fill" style="width:' +
      Math.min(100, pct) +
      '%"></div></div>' +
      '<div class="shaky-pct">' +
      pct +
      "%</div>" +
      "</button>";
  });
  html += "</div>";
  return html;
}

/* ---------- coverage warnings ---------- */

function renderGaps() {
  const rows = coverageGaps(30, 5);
  if (rows.length === 0) return "";
  let html =
    '<div class="today-section-label">No flashcards yet<span class="label-note">exam within 30 days</span></div>';
  html += '<div class="gap-list">';
  rows.forEach((r) => {
    html +=
      '<button class="gap-row" data-plan-act="open" data-page-id="' +
      r.pageId +
      '">' +
      '<div class="plan-icon">' +
      iconImg(r.icon, 18) +
      "</div>" +
      '<div class="plan-info"><div class="plan-title">' +
      escapeHtml(r.title) +
      '</div><div class="plan-detail">' +
      (r.subjectTitle ? escapeHtml(r.subjectTitle) + " \u00B7 " : "") +
      "exam in " +
      r.examDays +
      " day" +
      (r.examDays === 1 ? "" : "s") +
      "</div></div>" +
      '<div class="plan-go">' +
      ui("arrowRight", 15) +
      "</div>" +
      "</button>";
  });
  html += "</div>";
  return html;
}

/* ---------- weekly graph ---------- */

function renderWeek() {
  const week = weeklyCounts(7);
  const max = Math.max.apply(null, week.map((d) => d.count).concat([1]));
  const total = week.reduce((s, d) => s + d.count, 0);

  let html = '<div class="today-section-label">This week<span class="label-note">' + total + " reviewed</span></div>";
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
