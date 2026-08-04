// Past Practise attempts, shown on the page they were sat from (or everywhere
// when pageId is omitted). Matches the Quizzes and Mock exams lists.
import { escapeHtml, formatDateHuman } from "../utils.js";
import { ui } from "../icons.js";
import { practisesForPage, allPractiseAttempts } from "../practise/store.js";

function relative(ts) {
  if (!ts) return "";
  const days = Math.floor((Date.now() - ts) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return days + " days ago";
  return formatDateHuman(new Date(ts).toISOString().slice(0, 10));
}

export function renderPractisesSection(pageId) {
  const rows = (pageId ? practisesForPage(pageId) : allPractiseAttempts()).filter(
    (p) => p.status === "marked" || p.status === "in-progress"
  );
  if (!rows.length) return "";

  let html = '<div class="feedback-section">';
  html += '<div class="feedback-head"><span class="fh-title">Practices</span></div>';
  html += '<div class="attempt-list">';
  rows.slice(0, 6).forEach((p) => {
    const open = p.status !== "marked";
    const answered = p.answers
      ? Object.keys(p.answers.knowledge || {}).filter((k) => String(p.answers.knowledge[k] || "").trim()).length +
        Object.keys(p.answers.exam || {}).filter((k) => String(p.answers.exam[k] || "").trim()).length
      : 0;
    const total = p.practise
      ? (p.practise.knowledge.questions || []).length +
        (p.practise.exam ? (p.practise.exam.questions || []).length : 0)
      : 0;
    const hadExam = Boolean(p.practise && p.practise.exam);
    html +=
      '<button class="attempt-row' +
      (open ? " is-open" : "") +
      '" data-practise-open="' +
      (open ? "resume" : "results") +
      '" data-practise-id="' +
      p.id +
      '">' +
      '<span class="attempt-mark">' +
      (open ? "Unfinished" : p.result.totalMark + " / " + p.result.totalAvailable) +
      "</span>" +
      '<span class="attempt-info">' +
      '<span class="attempt-title">' +
      escapeHtml(p.title || "Practise") +
      "</span>" +
      '<span class="attempt-when">' +
      escapeHtml(
        (open ? answered + " of " + total + " answered" : p.result.percentage + "%") +
          " \u00b7 " +
          (hadExam ? "with exam questions" : "knowledge only") +
          " \u00b7 " +
          relative(p.startedAt)
      ) +
      (!pageId && p.pageTitle ? " \u00b7 " + escapeHtml(p.pageTitle) : "") +
      "</span></span>" +
      '<span class="plan-go">' +
      ui("arrowRight", 15) +
      "</span>" +
      "</button>";
  });
  html += "</div></div>";
  return html;
}
