// Turns the block tree of a page (and optionally its subpages) into the plain
// text the exam generator reads.
import { store, getPage, getChildren, getAncestors } from "../state.js";

const MAX_CHARS = 40000; // roughly 10k tokens - plenty for a topic's notes

function stripHtml(html) {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function blocksToText(blocks, out, depth) {
  if (!Array.isArray(blocks)) return;
  let n = 0;
  blocks.forEach((b) => {
    if (!b) return;
    if (b.type !== "numbered") n = 0;
    const t = stripHtml(b.content);
    switch (b.type) {
      case "heading1":
        if (t) out.push("\n## " + t);
        break;
      case "heading2":
      case "heading3":
        if (t) out.push("\n### " + t);
        break;
      case "paragraph":
      case "quote":
        if (t) out.push(t);
        break;
      case "bulleted":
        if (t) out.push("- " + t);
        break;
      case "numbered":
        n += 1;
        if (t) out.push(n + ". " + t);
        break;
      case "todo":
        if (t) out.push("- " + t);
        break;
      case "callout":
        if (t) out.push("Note: " + t);
        break;
      case "code":
        if (t) out.push(t);
        break;
      case "timeline":
        (b.items || []).forEach((it) => {
          const line = [stripHtml(it.date), stripHtml(it.title)].filter(Boolean).join(" - ");
          const detail = stripHtml(it.detail);
          if (line || detail) out.push("- " + [line, detail].filter(Boolean).join(": "));
        });
        break;
      case "table":
        (b.rows || []).forEach((row) => {
          const line = row.map((c) => stripHtml(c)).filter(Boolean).join(" | ");
          if (line) out.push(line);
        });
        break;
      case "definition": {
        // Key terms are flashcards, so give the model both sides.
        const term = stripHtml(b.term);
        const meaning = stripHtml(b.definition);
        const eg = stripHtml(b.example);
        if (term || meaning) {
          out.push("- " + [term, meaning].filter(Boolean).join(": ") + (eg ? " (e.g. " + eg + ")" : ""));
        }
        break;
      }
      case "comparison": {
        const left = stripHtml(b.leftLabel) || "A";
        const right = stripHtml(b.rightLabel) || "B";
        out.push("\n" + left + " vs " + right + ":");
        (b.rows || []).forEach((r) => {
          const l = stripHtml(r.left);
          const rr = stripHtml(r.right);
          if (l || rr) out.push("- " + left + ": " + l + " | " + right + ": " + rr);
        });
        break;
      }
      case "process":
        (b.steps || []).forEach((st, i) => {
          const text = stripHtml(st.text);
          const why = stripHtml(st.why);
          if (text) out.push(i + 1 + ". " + text + (why ? " (" + why + ")" : ""));
        });
        break;
      case "source": {
        const quote = stripHtml(b.quote);
        const who = [stripHtml(b.attribution), stripHtml(b.date)].filter(Boolean).join(", ");
        if (quote) out.push("Source: \u201c" + quote + "\u201d" + (who ? " - " + who : ""));
        const comment = stripHtml(b.comment);
        if (comment) out.push("Reading of it: " + comment);
        break;
      }
      case "statistic": {
        const value = stripHtml(b.value);
        const label = stripHtml(b.label);
        const context = stripHtml(b.context);
        if (value || label) out.push("- " + [value, label].filter(Boolean).join(" \u2014 ") + (context ? " (" + context + ")" : ""));
        break;
      }
      case "toggle": {
        // A toggle hides detail behind a heading; keep both.
        const q = stripHtml(b.summary);
        if (q) out.push("\n" + q);
        const inner = [];
        blocksToText(b.children, inner, depth + 1);
        if (inner.length) out.push(inner.join(" "));
        break;
      }
      case "image":
        if (stripHtml(b.caption)) out.push("[Image: " + stripHtml(b.caption) + "]");
        break;
      default:
        break;
    }
  });
}

export function pageWordCount(pageId) {
  const page = getPage(pageId);
  if (!page) return 0;
  const out = [];
  blocksToText(page.blocks, out, 0);
  const text = out.join(" ").trim();
  return text ? text.split(/\s+/).length : 0;
}

/**
 * Collect notes for a page.
 * includeSubpages: pull in every descendant page too, depth first, in order.
 * Returns { text, wordCount, pages: [titles], truncated }
 */
export function collectNotes(pageId, includeSubpages) {
  const root = getPage(pageId);
  if (!root) return { text: "", wordCount: 0, pages: [], truncated: false };

  const titles = [];
  const chunks = [];

  function walk(page, depth) {
    const out = [];
    blocksToText(page.blocks, out, 0);
    const body = out.join("\n").trim();
    titles.push(page.title || "Untitled");
    chunks.push(
      (depth === 0 ? "# " : "# " + "\u2014 ".repeat(0)) +
        (page.title || "Untitled") +
        "\n" +
        (body || "(no notes on this page)")
    );
    if (includeSubpages) getChildren(page.id).forEach((c) => walk(c, depth + 1));
  }

  walk(root, 0);

  let text = chunks.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
  let truncated = false;
  if (text.length > MAX_CHARS) {
    text = text.slice(0, MAX_CHARS) + "\n\n[Notes truncated here.]";
    truncated = true;
  }
  const wordCount = text ? text.split(/\s+/).length : 0;
  return { text, wordCount, pages: titles, truncated };
}

/** Titles of the page and everything above it - used for topic inference. */
export function titleTrail(pageId) {
  const page = getPage(pageId);
  if (!page) return [];
  const trail = getAncestors(pageId).map((p) => p.title || "");
  trail.push(page.title || "");
  return trail.filter(Boolean);
}

/** Titles of the page, its ancestors and all of its descendants. */
export function titleCloud(pageId) {
  const ids = [];
  function collect(id) {
    getChildren(id).forEach((c) => {
      ids.push(c.id);
      collect(c.id);
    });
  }
  collect(pageId);
  const extra = ids.map((id) => (store.state.pages[id] ? store.state.pages[id].title || "" : ""));
  return titleTrail(pageId).concat(extra).filter(Boolean);
}

export function subjectAncestor(pageId) {
  const chain = getAncestors(pageId);
  const page = getPage(pageId);
  if (page && page.type === "subject") return page;
  for (let i = 0; i < chain.length; i++) if (chain[i].type === "subject") return chain[i];
  return chain[0] || null;
}
