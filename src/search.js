// Full-text search across every page: titles, paragraph/heading text, key
// terms and their definitions, table cells, timeline entries, and every
// other text field a block stores.
//
// The index is rebuilt on every query rather than kept incrementally in
// sync with edits. That's the right trade at the scale of a personal
// revision workspace (a few hundred pages at most): it's cheap, and it can
// never drift from what's actually on screen the way a cached index could.
import { store, getAncestors } from "./state.js";
import { escapeHtml } from "./utils.js";

const MAX_RESULTS_PER_PAGE = 4;
const MAX_PAGES = 30;
const SNIPPET_RADIUS = 46;
const MIN_QUERY_LEN = 2;

function plainText(html) {
  if (!html) return "";
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  return (tmp.textContent || "").replace(/\s+/g, " ").trim();
}

function joinText(parts) {
  return parts.map(plainText).filter(Boolean).join(" \u2014 ");
}

/** One searchable row pulled out of a block, tagged with the block it came
 * from and an optional short label shown above its snippet. */
function pushEntry(out, blockId, label, text) {
  const clean = (text || "").replace(/\s+/g, " ").trim();
  if (clean) out.push({ blockId, label: label ? plainText(label) : "", text: clean });
}

function collectBlockText(blocks, out) {
  if (!Array.isArray(blocks)) return;
  blocks.forEach((b) => {
    if (!b || typeof b !== "object") return;
    switch (b.type) {
      case "paragraph":
      case "heading1":
      case "heading2":
      case "heading3":
      case "quote":
      case "bulleted":
      case "numbered":
      case "todo":
      case "code":
        pushEntry(out, b.id, "", plainText(b.content));
        break;
      case "callout":
        pushEntry(out, b.id, "", plainText(b.content));
        collectBlockText(b.children, out);
        break;
      case "toggle":
        pushEntry(out, b.id, "", plainText(b.summary));
        collectBlockText(b.children, out);
        break;
      case "definition":
        pushEntry(out, b.id, b.term, joinText([b.term, b.definition, b.example]));
        break;
      case "comparison":
        pushEntry(out, b.id, "", joinText([b.leftLabel, b.rightLabel]));
        (b.rows || []).forEach((r) => pushEntry(out, b.id, "", joinText([r.left, r.right])));
        break;
      case "process":
        (b.steps || []).forEach((s) => pushEntry(out, b.id, "", joinText([s.text, s.why])));
        break;
      case "source":
        pushEntry(out, b.id, b.attribution, joinText([b.quote, b.attribution, b.comment]));
        break;
      case "statistic":
        pushEntry(out, b.id, b.label, joinText([b.value, b.label, b.context]));
        break;
      case "timeline":
        (b.items || []).forEach((it) => pushEntry(out, b.id, it.title, joinText([it.date, it.title, it.detail])));
        break;
      case "table":
        (b.rows || []).forEach((row) => pushEntry(out, b.id, "", (row || []).map(plainText).filter(Boolean).join(" | ")));
        break;
      default:
        break;
    }
  });
}

function buildIndex() {
  const pages = store.state.pages || {};
  const index = [];
  for (const id in pages) {
    const p = pages[id];
    if (!p) continue;
    const entries = [];
    collectBlockText(p.blocks, entries);
    index.push({ page: p, entries });
  }
  return index;
}

function makeSnippet(text, query) {
  const lower = text.toLowerCase();
  const idx = lower.indexOf(query);
  if (idx === -1) {
    const short = text.length > 90 ? text.slice(0, 90) + "\u2026" : text;
    return escapeHtml(short);
  }
  const start = Math.max(0, idx - SNIPPET_RADIUS);
  const end = Math.min(text.length, idx + query.length + SNIPPET_RADIUS);
  let snippet = text.slice(start, end);
  if (start > 0) snippet = "\u2026" + snippet;
  if (end < text.length) snippet = snippet + "\u2026";
  const escaped = escapeHtml(snippet);
  const escQuery = escapeHtml(query).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp("(" + escQuery + ")", "ig");
  return escaped.replace(re, "<mark>$1</mark>");
}

/**
 * Searches every page's title and content for `rawQuery`. Returns up to
 * MAX_PAGES page-level results, each with up to MAX_RESULTS_PER_PAGE
 * matching snippets, ready to render.
 */
export function searchWorkspace(rawQuery) {
  const query = (rawQuery || "").trim().toLowerCase();
  if (query.length < MIN_QUERY_LEN) return [];

  const index = buildIndex();
  const results = [];

  index.forEach(({ page, entries }) => {
    const title = page.title || "Untitled";
    const titleMatch = title.toLowerCase().indexOf(query) > -1;
    const matches = [];
    entries.forEach((entry) => {
      if (entry.text.toLowerCase().indexOf(query) > -1) {
        matches.push({
          blockId: entry.blockId,
          label: entry.label,
          snippet: makeSnippet(entry.text, query)
        });
      }
    });
    if (!titleMatch && matches.length === 0) return;
    const ancestors = getAncestors(page.id);
    results.push({
      pageId: page.id,
      title,
      icon: page.icon,
      titleMatch,
      totalMatches: matches.length,
      matches: matches.slice(0, MAX_RESULTS_PER_PAGE),
      moreCount: Math.max(0, matches.length - MAX_RESULTS_PER_PAGE),
      breadcrumb: ancestors.map((a) => a.title || "Untitled")
    });
  });

  results.sort((a, b) => {
    if (a.titleMatch !== b.titleMatch) return a.titleMatch ? -1 : 1;
    if (a.totalMatches !== b.totalMatches) return b.totalMatches - a.totalMatches;
    return a.title.localeCompare(b.title);
  });

  return results.slice(0, MAX_PAGES);
}
