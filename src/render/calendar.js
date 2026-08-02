// The "Exam calendar" view: hero countdown plus upcoming / past exam lists.
import { escapeHtml, formatDateHuman, countdownInfo } from "../utils.js";
import { computeNextExam, computeAllExamRows } from "../exams.js";
import { iconImg, ui } from "../icons.js";

export function renderCalendarView() {
  const next = computeNextExam();
  const { upcoming, past } = computeAllExamRows();

  let html =
    '<div class="breadcrumbs"><span class="crumb current">' +
    iconImg("calendar", 14) +
    '<span class="crumb-text">Exam calendar</span></span></div>';
  html += '<div class="page-header"><div class="page-title">Exam calendar</div></div>';

  if (next) {
    const label = next.days === 0 ? "Today" : next.days === 1 ? "1 day" : next.days + " days";
    html +=
      '<div class="hero-countdown">' +
      '<div class="hero-number">' +
      escapeHtml(label) +
      "</div>" +
      '<div class="hero-sub">until <strong>' +
      escapeHtml(next.name) +
      "</strong><br>" +
      escapeHtml(next.subject || "Untitled") +
      " \u00B7 " +
      formatDateHuman(next.date) +
      "</div></div>";
  } else {
    html +=
      '<div class="hero-countdown"><div class="hero-number">\u2014</div>' +
      '<div class="hero-sub">No upcoming exams yet. Add exam dates on a subject page and they\u2019ll appear here.</div></div>';
  }

  html += '<div class="cal-section-label">Upcoming</div>';
  if (upcoming.length === 0) {
    html +=
      '<div class="cal-list"><div class="cal-row" style="cursor:default;"><div class="cal-info"><div class="cal-subject">Nothing scheduled.</div></div></div></div>';
  } else {
    html += '<div class="cal-list">' + upcoming.map((r, i) => renderCalRow(r, String(i + 1), false)).join("") + "</div>";
  }

  if (past.length > 0) {
    html += '<div class="cal-section-label">Past</div>';
    html += '<div class="cal-list">' + past.map((r) => renderCalRow(r, ui("check", 12, 2.6), true)).join("") + "</div>";
  }

  return html;
}

function renderCalRow(row, rank, isPast) {
  const ci = countdownInfo(row.date);
  return (
    '<div class="cal-row' +
    (isPast ? " past" : "") +
    '" data-nav="' +
    row.subjectId +
    '">' +
    '<div class="cal-rank">' +
    rank +
    "</div>" +
    '<div class="cal-icon">' +
    iconImg(row.subjectIcon, 19) +
    "</div>" +
    '<div class="cal-info"><div class="cal-name">' +
    escapeHtml(row.name) +
    '</div><div class="cal-subject">' +
    escapeHtml(row.subjectTitle) +
    "</div></div>" +
    '<div class="cal-date">' +
    formatDateHuman(row.date) +
    "</div>" +
    '<span class="badge ' +
    ci.cls +
    '">' +
    ci.label +
    "</span></div>"
  );
}
