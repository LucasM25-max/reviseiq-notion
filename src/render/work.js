/*
 * One place for everything you have already sat on a page: quizzes, practises
 * and mock papers, newest first.
 *
 * Previously these were three separate lists, one of them above the notes, so a
 * page with a bit of history opened onto a wall of results before a single line
 * of revision. They are now a single collapsed strip below the notes: the
 * headline is what happened last, and the full list is one click away.
 */
import { escapeHtml, formatDateHuman } from "../utils.js";
import { ui } from "../icons.js";
import { attemptRows, KIND_META } from "../evidence.js";

/* Collapsed by default. Kept in module state so a re-render mid-session does
   not slam the list shut under the user. */
let openFor = null;

export function toggleWorkList(key) {
  openFor = openFor === key ? null : key;
}

function relative(ts) {
  if (!ts) return "";
  const days = Math.floor((Date.now() - ts) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return days + " days ago";
  return formatDateHuman(new Date(ts).toISOString().slice(0, 10));
}

function pct(n) {
  return Math.round(n) + "%";
}

function rowHtml(row, showPage) {
  const meta = KIND_META[row.kind];
  const bits = [];
  if (row.percentage !== null && row.percentage !== undefined) bits.push(pct(row.percentage));
  if (row.detail) bits.push(row.detail);
  bits.push(relative(row.at));
  // Closes the loop: an attempt says what it left behind on the page.
  const cards = (row.cardsMade || 0) + (row.cardsResurfaced || 0);
  if (cards) bits.push(cards + (cards === 1 ? " card" : " cards"));
  if (showPage && row.pageTitle) bits.push(row.pageTitle);

  return (
    '<button class="wk-row' + (row.open ? " is-open" : "") + '"' + row.attrs + ">" +
    '<span class="wk-kind wk-' + row.kind + '" title="' + meta.label + '">' + ui(meta.icon, 15) + "</span>" +
    '<span class="wk-main">' +
    '<span class="wk-title">' + escapeHtml(row.title) + "</span>" +
    '<span class="wk-meta">' + escapeHtml(meta.label + " \u00b7 " + bits.join(" \u00b7 ")) + "</span>" +
    "</span>" +
    '<span class="wk-score' + (row.open ? " is-open" : "") + '">' +
    (row.open ? "Unfinished" : escapeHtml(row.score)) +
    "</span>" +
    '<span class="wk-go">' + ui("arrowRight", 15) + "</span>" +
    "</button>"
  );
}

/**
 * The whole strip. `pageId` omitted means "everywhere", which is how the Plan
 * screen uses it.
 */
export function renderWorkSection(pageId, options) {
  const opts = options || {};
  const key = pageId || "all";
  const rows = attemptRows(pageId);
  if (!rows.length) return "";

  const marked = rows.filter((r) => !r.open && r.percentage !== null && r.percentage !== undefined);
  const unfinished = rows.filter((r) => r.open);
  const last = marked[0];
  const best = marked.length ? Math.max.apply(null, marked.map((r) => r.percentage)) : null;
  const open = openFor === key || opts.startOpen === true;
  const shown = open ? rows.slice(0, 12) : rows.slice(0, unfinished.length ? unfinished.length : 1);

  const summary = [];
  summary.push(rows.length + (rows.length === 1 ? " attempt" : " attempts"));
  if (last) summary.push("last " + pct(last.percentage));
  if (best !== null && marked.length > 1) summary.push("best " + pct(best));
  if (unfinished.length) summary.push(unfinished.length + " unfinished");

  let html = '<div class="wk-section">';
  html +=
    '<button class="wk-head" data-work-toggle="' + escapeHtml(key) + '" aria-expanded="' + (open ? "true" : "false") + '">' +
    '<span class="wk-head-title">' + escapeHtml(opts.title || "Marked work") + "</span>" +
    '<span class="wk-head-sum">' + escapeHtml(summary.join(" \u00b7 ")) + "</span>" +
    '<span class="wk-chev' + (open ? " is-open" : "") + '">' + ui("chevron", 15) + "</span>" +
    "</button>";

  html += '<div class="wk-list">';
  shown.forEach((r) => {
    html += rowHtml(r, !pageId);
  });
  html += "</div>";

  if (!open && rows.length > shown.length) {
    html +=
      '<button class="wk-more" data-work-toggle="' + escapeHtml(key) + '">Show ' +
      (rows.length - shown.length) + " more</button>";
  }
  if (open && rows.length > 12) {
    html += '<div class="wk-note">Showing the 12 most recent of ' + rows.length + ".</div>";
  }

  html += "</div>";
  return html;
}
