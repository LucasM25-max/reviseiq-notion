// Permanent "Exam feedback" list: focus areas and missed points kept from every
// marked mock, shown on the page they came from and on the Today dashboard.
import { escapeHtml, formatDateHuman } from "../utils.js";
import { ui } from "../icons.js";
import { openInsights, attemptsForPage, allAttempts } from "../exam/insights.js";
import { quizzesForPage, allQuizAttempts } from "../quiz/store.js";

const KIND_LABEL = { focus: "Focus area", missed: "Missed point", gap: "Notes gap" };

function relative(ts) {
  if (!ts) return "";
  const days = Math.floor((Date.now() - ts) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return days + " days ago";
  return formatDateHuman(new Date(ts).toISOString().slice(0, 10));
}

function row(item, showPage) {
  return (
    '<div class="feedback-row kind-' +
    item.kind +
    '">' +
    '<button class="feedback-tick" data-insight-act="resolve" data-insight-id="' +
    item.id +
    '" title="I\u2019ve sorted this"></button>' +
    '<div class="feedback-main">' +
    '<div class="feedback-text">' +
    escapeHtml(item.text) +
    "</div>" +
    (item.detail ? '<div class="feedback-detail">' + escapeHtml(item.detail) + "</div>" : "") +
    '<div class="feedback-meta">' +
    '<span class="feedback-tag t-' +
    item.kind +
    '">' +
    (KIND_LABEL[item.kind] || "Feedback") +
    "</span>" +
    (showPage && item.pageTitle
      ? '<span data-nav="' + item.pageId + '">' + escapeHtml(item.pageTitle) + "</span>"
      : "") +
    (item.questionNumber ? "<span>Q" + item.questionNumber + "</span>" : "") +
    (item.componentShort ? "<span>" + escapeHtml(item.componentShort) + "</span>" : "") +
    "<span>" +
    relative(item.lastSeen) +
    "</span>" +
    ((item.seen || 1) > 1
      ? '<span class="feedback-repeat">missed ' + item.seen + " times</span>"
      : "") +
    "</div></div></div>"
  );
}

/**
 * opts: { pageId?, limit?, title?, showPage?, showEmpty? }
 * Omitting pageId shows feedback from across the whole workspace.
 */
export function renderFeedbackSection(opts) {
  const o = opts || {};
  const items = openInsights(o.pageId ? { pageId: o.pageId } : null);
  const limit = o.limit || 8;
  const shown = items.slice(0, limit);

  if (!items.length && !o.showEmpty) return "";

  let html = '<div class="feedback-section">';
  html +=
    '<div class="feedback-head">' +
    '<span class="fh-title">' +
    escapeHtml(o.title || "Exam feedback") +
    "</span>" +
    (items.length ? '<span class="fh-count">' + items.length + " open</span>" : "") +
    "</div>";

  if (!items.length) {
    html +=
      '<div class="feedback-empty">Nothing outstanding. Anything an examiner flags in a mock is kept here until you tick it off.</div>';
    return html + "</div>";
  }

  html += '<div class="feedback-list">' + shown.map((i) => row(i, o.showPage !== false && !o.pageId)).join("") + "</div>";
  if (items.length > shown.length) {
    html +=
      '<button class="feedback-more" data-insight-act="expand">Show ' +
      (items.length - shown.length) +
      " more" +
      "</button>";
  }
  html += "</div>";
  return html;
}

/** Past mock attempts for one page (or everywhere when pageId is omitted). */
export function renderAttemptsSection(pageId) {
  const rows = (pageId ? attemptsForPage(pageId) : allAttempts()).filter(
    (a) => a.status === "marked" || a.status === "in-progress"
  );
  if (!rows.length) return "";

  let html = '<div class="feedback-section">';
  html += '<div class="feedback-head"><span class="fh-title">Mock exams</span></div>';
  html += '<div class="attempt-list">';
  rows.slice(0, 6).forEach((a) => {
    const open = a.status === "in-progress";
    html +=
      '<button class="attempt-row' +
      (open ? " is-open" : "") +
      '" data-test-act="' +
      (open ? "resume" : "results") +
      '" data-test-id="' +
      a.id +
      '">' +
      '<span class="attempt-mark">' +
      (open ? "Unfinished" : a.result.totalMark + " / " + a.result.totalAvailable) +
      "</span>" +
      '<span class="attempt-info">' +
      '<span class="attempt-title">' +
      escapeHtml(a.optionLabel || "") +
      "</span>" +
      '<span class="attempt-when">' +
      escapeHtml((a.componentShort || "") + " \u00b7 " + relative(a.startedAt)) +
      (!pageId && a.pageTitle ? " \u00b7 " + escapeHtml(a.pageTitle) : "") +
      "</span></span>" +
      '<span class="plan-go">' +
      ui("arrowRight", 15) +
      "</span>" +
      "</button>";
  });
  html += "</div></div>";
  return html;
}

/** Past Quiz me attempts for one page (or everywhere when pageId is omitted). */
export function renderQuizzesSection(pageId) {
  const rows = (pageId ? quizzesForPage(pageId) : allQuizAttempts()).filter(
    (q) => q.status === "marked" || q.status === "in-progress"
  );
  if (!rows.length) return "";

  let html = '<div class="feedback-section">';
  html += '<div class="feedback-head"><span class="fh-title">Quizzes</span></div>';
  html += '<div class="attempt-list">';
  rows.slice(0, 6).forEach((q) => {
    const open = q.status === "in-progress";
    const answered = Object.keys(q.answers || {}).length;
    const total = q.quiz && q.quiz.questions ? q.quiz.questions.length : 0;
    html +=
      '<button class="attempt-row' +
      (open ? " is-open" : "") +
      '" data-quiz-act="' +
      (open ? "resume" : "results") +
      '" data-quiz-id="' +
      q.id +
      '">' +
      '<span class="attempt-mark quiz-attempt-score">' +
      (open ? "Unfinished" : q.result.score + " / " + q.result.total) +
      "</span>" +
      '<span class="attempt-info">' +
      '<span class="attempt-title">' +
      escapeHtml(q.title || "Quiz") +
      "</span>" +
      '<span class="attempt-when">' +
      escapeHtml(
        (open ? answered + " of " + total + " answered" : q.result.percentage + "%") +
          " \u00b7 " +
          relative(q.startedAt)
      ) +
      (!pageId && q.pageTitle ? " \u00b7 " + escapeHtml(q.pageTitle) : "") +
      "</span></span>" +
      '<span class="plan-go">' +
      ui("arrowRight", 15) +
      "</span>" +
      "</button>";
  });
  html += "</div></div>";
  return html;
}
