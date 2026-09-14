// Reconstruct pages copied with the pre-structured-clipboard implementation.
// Those copies have no ReviseIQ custom MIME data, so we recover the block
// structure from the semantic HTML that the old Copy button put on the
// clipboard (and that Google Docs generally preserves when copying back).

import { uid, sanitizeHtmlFragment, escapeHtml } from "./utils.js";
import { store, getPage } from "./state.js";
import { insertBlockAfter } from "./blocks.js";
import { renderBlocksOnly } from "./render/main.js";
import { scheduleSave } from "./storage.js";
import { focusBlock } from "./focus.js";

function inlineHtml(value) {
  return sanitizeHtmlFragment(String(value || "")).replace(/<br>$/, "");
}

function isLegacyReviseIqHtml(html) {
  if (!html || !/<h1\b/i.test(html)) return false;
  // The original exporter wrapped the page in this font declaration. Keep it
  // as the strongest signal, but also accept Google Docs copies where the
  // wrapper styling has been normalised/removed.
  if (/font-family\s*:\s*Arial,?\s*Helvetica,?\s*sans-serif/i.test(html)) return true;
  return /<(?:h2|h3|h4|ul|ol|table|blockquote|pre|hr)\b/i.test(html);
}

function makeBlock(type, extra) {
  return Object.assign({ id: uid(), type }, extra || {});
}

function parseTable(el) {
  const rows = Array.from(el.querySelectorAll(":scope > tbody > tr, :scope > tr")).map((row) =>
    Array.from(row.children).map((cell) => inlineHtml(cell.innerHTML))
  );
  return rows.length ? makeBlock("table", { rows }) : null;
}

function parseList(el, out) {
  const type = el.tagName.toLowerCase() === "ul" ? "bulleted" : "numbered";
  Array.from(el.children).forEach((li) => {
    if (!li.tagName || li.tagName.toLowerCase() !== "li") return;
    // A nested list becomes additional blocks rather than getting swallowed
    // into the parent item's rich text.
    const nested = Array.from(li.children).find((child) => /^(UL|OL)$/i.test(child.tagName));
    const clone = li.cloneNode(true);
    if (nested) clone.removeChild(nested);
    if (clone.textContent.trim() || clone.innerHTML.trim()) {
      out.push(makeBlock(type, { content: inlineHtml(clone.innerHTML) }));
    }
    if (nested) parseElement(nested, out);
  });
}

function looksLikeLegacyCallout(el) {
  const style = (el.getAttribute("style") || "").toLowerCase();
  return /border-left\s*:\s*3px/.test(style) && /background\s*:\s*#?f7f7f7/.test(style);
}

function parseDiv(el, out) {
  // Old callouts were generic styled divs. Recover them when the distinctive
  // border/background survived the trip through Google Docs.
  if (looksLikeLegacyCallout(el)) {
    const kids = Array.from(el.children);
    const title = kids.find((child) => child.tagName.toLowerCase() === "p");
    const titleText = title ? title.textContent.trim() : "";
    const childBlocks = [];
    kids.forEach((child) => {
      if (child === title) return;
      parseElement(child, childBlocks);
    });
    out.push(
      makeBlock("callout", {
        content: title ? inlineHtml(title.innerHTML.replace(/^\s*<strong>|<\/strong>\s*$/gi, "")) : "",
        children: childBlocks
      })
    );
    return;
  }

  // Old image blocks were wrapped in a plain div. Recover the image rather
  // than reducing it to an empty paragraph.
  const img = el.querySelector(":scope > img");
  if (img) {
    const caption = Array.from(el.children).find((child) => child !== img && child.tagName.toLowerCase() === "div");
    out.push(
      makeBlock("image", {
        src: img.getAttribute("src") || null,
        caption: caption ? caption.textContent.trim() : ""
      })
    );
    return;
  }

  Array.from(el.children).forEach((child) => parseElement(child, out));
}

function parseElement(el, out) {
  if (!el || el.nodeType !== 1) return;
  const tag = el.tagName.toLowerCase();

  if (tag === "h1") return; // The page title should not become a note block.
  if (tag === "h2" || tag === "h3" || tag === "h4") {
    const type = tag === "h2" ? "heading1" : tag === "h3" ? "heading2" : "heading3";
    out.push(makeBlock(type, { content: inlineHtml(el.innerHTML) }));
    return;
  }
  if (tag === "p") {
    if (el.textContent.trim() || el.innerHTML.trim()) out.push(makeBlock("paragraph", { content: inlineHtml(el.innerHTML) }));
    return;
  }
  if (tag === "blockquote") {
    let content = el.innerHTML;
    const text = el.textContent.trim();
    // Old source blocks were exported as curly-quoted blockquotes. Treat
    // those as normal quotes when the attribution was not retained.
    if (text.startsWith("“") && text.endsWith("”")) {
      content = inlineHtml(content.replace(/^\s*“/, "").replace(/”\s*$/, ""));
    }
    out.push(makeBlock("quote", { content: inlineHtml(content) }));
    return;
  }
  if (tag === "ul" || tag === "ol") {
    parseList(el, out);
    return;
  }
  if (tag === "hr") {
    out.push(makeBlock("divider"));
    return;
  }
  if (tag === "pre") {
    out.push(makeBlock("code", { content: el.textContent || "", lang: "" }));
    return;
  }
  if (tag === "table") {
    const block = parseTable(el);
    if (block) out.push(block);
    return;
  }
  if (tag === "div") {
    parseDiv(el, out);
    return;
  }
  Array.from(el.children).forEach((child) => parseElement(child, out));
}

function legacyHtmlToBlocks(html) {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = html || "";
  const root = wrapper.querySelector("[data-reviseiq-clipboard]") || wrapper;
  const children = Array.from(root.children);
  const out = [];
  children.forEach((child) => parseElement(child, out));
  return out;
}

async function insertLegacyBlocks(target, blocks) {
  if (!blocks.length) return;
  const page = getPage(store.state.activePageId);
  if (!page) return;

  const row = target.closest(".block-row");
  const targetId = row ? row.dataset.blockId : null;
  if (targetId) {
    let afterId = targetId;
    blocks.forEach((block) => {
      insertBlockAfter(page, afterId, block);
      afterId = block.id;
    });
  } else {
    page.blocks.push(...blocks);
  }

  renderBlocksOnly();
  scheduleSave();
  focusBlock(blocks[0].id, true);
}

export function initLegacyClipboardPaste() {
  const install = () => {
    if (document.documentElement.dataset.legacyReviseIqClipboardInstalled === "1") return;
    document.documentElement.dataset.legacyReviseIqClipboardInstalled = "1";

    document.addEventListener("paste", (event) => {
      const target = event.target && event.target.closest ? event.target.closest(".rt") : null;
      if (!target || !event.clipboardData) return;

      const html = event.clipboardData.getData("text/html") || "";
      if (!isLegacyReviseIqHtml(html)) return;

      const blocks = legacyHtmlToBlocks(html);
      if (!blocks.length) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      insertLegacyBlocks(target, blocks).catch(() => {
        // Leave the normal paste path untouched if recovery fails.
      });
    }, true);
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true });
  else install();
}
