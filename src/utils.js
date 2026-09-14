// Small shared helpers: ids, escaping, sanitising, dates, media.

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

export function escapeHtml(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const ALLOWED_INLINE_TAGS = { B: 1, STRONG: 1, I: 1, EM: 1, U: 1, S: 1, STRIKE: 1, CODE: 1, A: 1, BR: 1, SPAN: 1 };

function sanitizeInlineNode(node, out) {
  for (let i = 0; i < node.childNodes.length; i++) {
    const child = node.childNodes[i];
    if (child.nodeType === 3) {
      out.push(escapeHtml(child.nodeValue));
      continue;
    }
    if (child.nodeType !== 1) continue;
    const tag = child.tagName;
    if (tag === "IMG" || tag === "SCRIPT" || tag === "STYLE") continue;
    if (tag === "DIV" || tag === "P" || tag === "LI") {
      const inner = [];
      sanitizeInlineNode(child, inner);
      out.push(inner.join("") + "<br>");
      continue;
    }
    if (ALLOWED_INLINE_TAGS[tag]) {
      if (tag === "A") {
        let href = child.getAttribute("href") || "";
        if (!/^https?:\/\//i.test(href)) href = "";
        out.push('<a href="' + escapeHtml(href) + '" target="_blank" rel="noopener noreferrer">');
        const inner2 = [];
        sanitizeInlineNode(child, inner2);
        out.push(inner2.join(""));
        out.push("</a>");
      } else if (tag === "BR") {
        out.push("<br>");
      } else {
        const t = tag.toLowerCase();
        out.push("<" + t + ">");
        const inner3 = [];
        sanitizeInlineNode(child, inner3);
        out.push(inner3.join(""));
        out.push("</" + t + ">");
      }
    } else {
      sanitizeInlineNode(child, out);
    }
  }
}

export function sanitizeHtmlFragment(html) {
  try {
    const tmp = document.createElement("div");
    tmp.innerHTML = html;
    const out = [];
    sanitizeInlineNode(tmp, out);
    return out.join("");
  } catch (e) {
    return escapeHtml(html);
  }
}

export function pad2(n) {
  return n < 10 ? "0" + n : "" + n;
}

export function todayStr() {
  const d = new Date();
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
}

export function daysUntil(dateStr) {
  if (!dateStr) return null;
  const parts = dateStr.split("-");
  const target = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  const now = new Date();
  const todayOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - todayOnly) / 86400000);
}

export function formatDateHuman(dateStr) {
  if (!dateStr) return "";
  const parts = dateStr.split("-");
  const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return d.getDate() + " " + months[d.getMonth()] + " " + d.getFullYear();
}

export function countdownInfo(dateStr) {
  const d = daysUntil(dateStr);
  if (d === null) return { label: "", cls: "" };
  if (d < 0) return { label: "Past", cls: "past" };
  if (d === 0) return { label: "Today", cls: "urgent" };
  if (d === 1) return { label: "1 day", cls: "urgent" };
  if (d <= 7) return { label: d + " days", cls: "urgent" };
  if (d <= 30) return { label: d + " days", cls: "soon" };
  return { label: d + " days", cls: "later" };
}

export function extractYouTubeId(url) {
  try {
    const u = new URL(String(url).trim());
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtu.be") {
      return u.pathname.slice(1).split("/")[0] || null;
    }
    if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
      if (u.pathname === "/watch") return u.searchParams.get("v");
      if (u.pathname.indexOf("/embed/") === 0) return u.pathname.split("/")[2] || null;
      if (u.pathname.indexOf("/shorts/") === 0) return u.pathname.split("/")[2] || null;
      if (u.pathname.indexOf("/live/") === 0) return u.pathname.split("/")[2] || null;
    }
    return null;
  } catch (e) {
    return null;
  }
}

export function compressImageFile(file) {
  return new Promise((resolve, reject) => {
    if (!file || file.type.indexOf("image/") !== 0) {
      reject(new Error("That file isn't an image."));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Couldn't read that image."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Couldn't load that image."));
      img.onload = () => {
        try {
          const maxDim = 1000;
          let w = img.naturalWidth;
          let h = img.naturalHeight;
          if (w <= 0 || h <= 0) {
            reject(new Error("That image looks empty."));
            return;
          }
          if (w > maxDim || h > maxDim) {
            if (w > h) {
              h = Math.round((h * maxDim) / w);
              w = maxDim;
            } else {
              w = Math.round((w * maxDim) / h);
              h = maxDim;
            }
          }
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL("image/jpeg", 0.72));
        } catch (e) {
          reject(e);
        }
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

const SUBJECT_ICON_MAP = [
  [/math/i, "\uD83D\uDD22"],
  [/bio/i, "\uD83E\uDDEC"],
  [/chem/i, "\u2697\uFE0F"],
  [/phys/i, "\u269B\uFE0F"],
  [/english/i, "\uD83D\uDCD6"],
  [/histor/i, "\uD83C\uDFDB\uFE0F"],
  [/geog/i, "\uD83C\uDF0D"],
  [/french|spanish|german|language/i, "\uD83D\uDDE3\uFE0F"],
  [/art/i, "\uD83C\uDFA8"],
  [/music/i, "\uD83C\uDFB5"],
  [/comput|it\b/i, "\uD83D\uDCBB"],
  [/pe\b|physical education|sport/i, "\u26BD"],
  [/religio|rs\b/i, "\uD83D\uDE4F"],
  [/business/i, "\uD83D\uDCBC"],
  [/drama/i, "\uD83C\uDFAD"],
  [/design|dt\b/i, "\uD83D\uDCD0"],
  [/psycholog/i, "\uD83E\uDDE0"]
];

export function defaultIconForTitle(title) {
  for (let i = 0; i < SUBJECT_ICON_MAP.length; i++) {
    if (SUBJECT_ICON_MAP[i][0].test(title)) return SUBJECT_ICON_MAP[i][1];
  }
  return "\uD83D\uDCD8";
}

export function debounce(fn, ms) {
  let t = null;
  return function (...args) {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), ms);
  };
}

export const EMOJI_PRESET = [
  "\uD83D\uDCD8", "\uD83D\uDCD7", "\uD83D\uDCD9", "\uD83D\uDCDA", "\uD83D\uDCDD", "\uD83D\uDCD0", "\uD83E\uDDEA",
  "\uD83D\uDD2C", "\uD83E\uDDEC", "\u2697\uFE0F", "\u269B\uFE0F", "\uD83D\uDD22", "\uD83C\uDF0D", "\uD83C\uDFDB\uFE0F",
  "\uD83C\uDFA8", "\uD83C\uDFB5", "\uD83C\uDFAD", "\uD83D\uDCBB", "\uD83D\uDCBC", "\u26BD", "\uD83E\uDDE0",
  "\uD83D\uDE4F", "\uD83D\uDD2D", "\uD83E\uDDF2", "\uD83C\uDF1F", "\u2728", "\uD83D\uDCAA", "\u23F0",
  "\uD83C\uDFAF", "\u2705", "\uD83D\uDD25", "\uD83D\uDCA1", "\uD83D\uDCCE", "\uD83D\uDDC2\uFE0F", "\uD83C\uDF93", "\u270F\uFE0F"
];

export const CALLOUT_EMOJI = ["\uD83D\uDCA1", "\uD83D\uDCCC", "\u26A0\uFE0F", "\u2705", "\u2757", "\uD83D\uDCDD", "\uD83D\uDD11", "\u2B50"];

/* ------------------------------------------------------------------------- */
/* Clipboard round-trip support                                             */
/* ------------------------------------------------------------------------- */

const REVISEIQ_CLIPBOARD_MIME = "application/x-reviseiq-notes+json";
const REVISEIQ_CLIPBOARD_TEXT_MARKER = "\u2063REViseIQ-NOTES-v1\u2063";

function clipboardInline(value) {
  return String(value || "");
}

function clipboardRows(blocks) {
  if (!Array.isArray(blocks)) return "";
  let html = "";
  let i = 0;
  while (i < blocks.length) {
    const b = blocks[i];
    if (!b) {
      i++;
      continue;
    }
    if (b.type === "bulleted" || b.type === "numbered") {
      const tag = b.type === "bulleted" ? "ul" : "ol";
      html += "<" + tag + ' style="margin:8px 0 8px 24px;padding-left:20px;">';
      while (i < blocks.length && blocks[i] && blocks[i].type === b.type) {
        html += "<li>" + clipboardInline(blocks[i].content) + "</li>";
        i++;
      }
      html += "</" + tag + ">";
      continue;
    }
    html += clipboardRow(b);
    i++;
  }
  return html;
}

function clipboardRow(block) {
  if (!block) return "";
  const content = clipboardInline(block.content);
  switch (block.type) {
    case "paragraph":
      return '<p style="margin:8px 0;">' + content + "</p>";
    case "heading1":
      return '<h2 style="margin:18px 0 8px 0;">' + content + "</h2>";
    case "heading2":
      return '<h3 style="margin:16px 0 7px 0;">' + content + "</h3>";
    case "heading3":
      return '<h4 style="margin:14px 0 6px 0;">' + content + "</h4>";
    case "quote":
      return '<blockquote style="margin:10px 0;padding-left:14px;border-left:3px solid #999;">' + content + "</blockquote>";
    case "todo":
      return '<p style="margin:8px 0;">' + (block.checked ? "☑" : "☐") + " " + content + "</p>";
    case "divider":
      return '<hr style="margin:18px 0;border:0;border-top:1px solid #aaa;" />';
    case "code":
      return (block.lang
        ? '<div style="font-size:11px;font-weight:600;margin:10px 0 3px 0;">' + escapeHtml(block.lang) + "</div>"
        : "") +
        '<pre style="margin:6px 0 12px 0;padding:10px;background:#f3f3f3;white-space:pre-wrap;font-family:monospace;">' +
        escapeHtml(block.content || "") +
        "</pre>";
    case "table": {
      const rows = Array.isArray(block.rows) ? block.rows : [];
      let out = '<table style="border-collapse:collapse;width:100%;margin:10px 0;"><tbody>';
      rows.forEach((row, r) => {
        const cells = Array.isArray(row) ? row : [];
        out += "<tr>";
        cells.forEach((cell) => {
          out +=
            '<' +
            (r === 0 ? "th" : "td") +
            ' style="border:1px solid #999;padding:6px;vertical-align:top;">' +
            clipboardInline(cell) +
            "</" +
            (r === 0 ? "th" : "td") +
            ">";
        });
        out += "</tr>";
      });
      return out + "</tbody></table>";
    }
    case "image":
      return block.src
        ? '<div style="margin:10px 0;"><img src="' + escapeHtml(block.src) + '" style="max-width:100%;border-radius:6px;display:block;" />' +
          (block.caption ? '<div style="font-size:12px;font-style:italic;">' + escapeHtml(block.caption) + "</div>" : "") +
          "</div>"
        : "";
    case "video":
      return '<p style="margin:8px 0;">YouTube video</p>';
    case "page":
      return '<p style="margin:8px 0;"><strong>Subpage</strong></p>';
    case "callout":
      return '<div style="margin:10px 0;padding:10px 12px;border-left:3px solid #888;background:#f7f7f7;">' +
        '<p style="margin:0 0 8px 0;"><strong>' + content + "</strong></p>" +
        clipboardRows(block.children) +
        "</div>";
    case "toggle":
      return '<h3 style="margin:14px 0 6px 0;">' + clipboardInline(block.summary) + "</h3>" + clipboardRows(block.children);
    case "definition":
      return '<p style="margin:10px 0 3px 0;"><strong>' + clipboardInline(block.term) + "</strong></p>" +
        '<p style="margin:3px 0;">' + clipboardInline(block.definition) + "</p>" +
        (block.example ? '<p style="margin:3px 0;font-style:italic;">Example: ' + clipboardInline(block.example) + "</p>" : "");
    case "comparison": {
      const rows = Array.isArray(block.rows) ? block.rows : [];
      let out = '<table style="border-collapse:collapse;width:100%;margin:10px 0;"><tbody><tr>' +
        '<th style="border:1px solid #999;padding:6px;text-align:left;">' + clipboardInline(block.leftLabel) + "</th>" +
        '<th style="border:1px solid #999;padding:6px;text-align:left;">' + clipboardInline(block.rightLabel) + "</th></tr>";
      rows.forEach((r) => {
        out += "<tr><td style=\"border:1px solid #999;padding:6px;vertical-align:top;\">" + clipboardInline(r.left) +
          "</td><td style=\"border:1px solid #999;padding:6px;vertical-align:top;\">" + clipboardInline(r.right) + "</td></tr>";
      });
      return out + "</tbody></table>";
    }
    case "process":
      return '<ol style="margin:8px 0 8px 24px;padding-left:20px;">' +
        (Array.isArray(block.steps) ? block.steps : []).map((step) =>
          '<li>' + clipboardInline(step.text) + (step.why ? " — " + clipboardInline(step.why) : "") + "</li>"
        ).join("") +
        "</ol>";
    case "timeline":
      return (Array.isArray(block.items) ? block.items : []).map((item) =>
        '<p style="margin:10px 0 3px 0;"><strong>' + clipboardInline(item.date) + " — " + clipboardInline(item.title) + "</strong></p>" +
        (item.detail ? '<p style="margin:3px 0 10px 0;">' + clipboardInline(item.detail) + "</p>" : "")
      ).join("");
    case "source":
      return (block.quote
        ? '<blockquote style="margin:10px 0;padding-left:14px;border-left:3px solid #999;">“' + clipboardInline(block.quote) + "”</blockquote>"
        : "") +
        (block.attribution || block.date
          ? '<p style="margin:3px 0;"><strong>' + clipboardInline([block.attribution, block.date].filter(Boolean).join(", ")) + "</strong></p>"
          : "") +
        (block.comment ? '<p style="margin:3px 0;">Reading of it: ' + clipboardInline(block.comment) + "</p>" : "");
    case "statistic":
      return '<p style="margin:8px 0;"><strong>' + clipboardInline(block.value) + "</strong> — " + clipboardInline(block.label) +
        (block.context ? " (" + clipboardInline(block.context) + ")" : "") + "</p>";
    default:
      return "";
  }
}

function buildReviseIqClipboardHtml(page) {
  const payload = JSON.stringify({ version: 1, kind: "reviseiq-notes", title: page.title || "", blocks: page.blocks || [] });
  const encoded = escapeHtml(payload);
  return '<div data-reviseiq-clipboard="1" data-reviseiq-version="1" data-reviseiq-payload="' + encoded + '" style="font-family:Arial,Helvetica,sans-serif;line-height:1.45;">' +
    '<h1 style="font-size:24px;margin:0 0 16px 0;">' + escapeHtml(page.title || "Untitled") + "</h1>" +
    clipboardRows(page.blocks) +
    "</div>";
}

function clipboardPlainTextFromHtml(html) {
  const temp = document.createElement("div");
  temp.innerHTML = html;
  const text = temp.innerText || temp.textContent || "";
  temp.remove();
  return text.replace(/\u00a0/g, " ").replace(/[ \t]+\n/g, "\n").trim();
}

function cloneClipboardBlock(block) {
  const copy = JSON.parse(JSON.stringify(block));
  const reId = (value) => {
    if (value && typeof value === "object") {
      if (Object.prototype.hasOwnProperty.call(value, "id")) value.id = uid();
      Object.keys(value).forEach((key) => reId(value[key]));
    } else if (Array.isArray(value)) {
      value.forEach(reId);
    }
  };
  reId(copy);
  return copy;
}

function inlineHtmlForPaste(value) {
  return sanitizeHtmlFragment(String(value || "")).replace(/<br>$/, "");
}

function htmlElementToBlocks(el, out) {
  if (!el || el.nodeType !== 1) return;
  const tag = el.tagName.toLowerCase();
  if (tag === "h1" || tag === "h2" || tag === "h3" || tag === "h4") {
    const type = tag === "h1" || tag === "h2" ? "heading1" : tag === "h3" ? "heading2" : "heading3";
    out.push({ id: uid(), type, content: inlineHtmlForPaste(el.innerHTML) });
    return;
  }
  if (tag === "p") {
    if (el.textContent.trim() || el.innerHTML.trim()) out.push({ id: uid(), type: "paragraph", content: inlineHtmlForPaste(el.innerHTML) });
    return;
  }
  if (tag === "blockquote") {
    out.push({ id: uid(), type: "quote", content: inlineHtmlForPaste(el.innerHTML) });
    return;
  }
  if (tag === "ul" || tag === "ol") {
    Array.from(el.children).forEach((li) => {
      if (li.tagName && li.tagName.toLowerCase() === "li") {
        out.push({ id: uid(), type: tag === "ul" ? "bulleted" : "numbered", content: inlineHtmlForPaste(li.innerHTML) });
      }
    });
    return;
  }
  if (tag === "hr") {
    out.push({ id: uid(), type: "divider" });
    return;
  }
  if (tag === "pre") {
    out.push({ id: uid(), type: "code", content: el.textContent || "", lang: "" });
    return;
  }
  if (tag === "table") {
    const rows = Array.from(el.querySelectorAll("tr")).map((row) =>
      Array.from(row.children).map((cell) => inlineHtmlForPaste(cell.innerHTML))
    );
    if (rows.length) out.push({ id: uid(), type: "table", rows });
    return;
  }
  Array.from(el.children).forEach((child) => htmlElementToBlocks(child, out));
}

function htmlToBlocks(html) {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = html || "";
  const markerRoot = wrapper.querySelector("[data-reviseiq-clipboard]");
  const root = markerRoot || wrapper;
  const out = [];
  Array.from(root.children).forEach((el, index) => {
    if (markerRoot && index === 0 && el.tagName.toLowerCase() === "h1") return;
    htmlElementToBlocks(el, out);
  });
  return out;
}

async function insertClipboardBlocks(target, blocks) {
  if (!Array.isArray(blocks) || !blocks.length) return;
  const [{ store, getPage }, { insertBlockAfter }, { renderBlocksOnly }, { scheduleSave }, { focusBlock }] = await Promise.all([
    import("./state.js"),
    import("./blocks.js"),
    import("./render/main.js"),
    import("./storage.js"),
    import("./focus.js")
  ]);
  const page = getPage(store.state.activePageId);
  if (!page) return;

  const row = target.closest(".block-row");
  const targetId = row ? row.dataset.blockId : null;
  const clones = blocks.map(cloneClipboardBlock);

  if (targetId) {
    let afterId = targetId;
    clones.forEach((block) => {
      insertBlockAfter(page, afterId, block);
      afterId = block.id;
    });
  } else {
    page.blocks.push(...clones);
  }

  renderBlocksOnly();
  scheduleSave();
  focusBlock(clones[0].id, true);
}

function installClipboardRoundTrip() {
  const install = () => {
    if (document.documentElement.dataset.reviseiqClipboardInstalled === "1") return;
    document.documentElement.dataset.reviseiqClipboardInstalled = "1";

    const style = document.createElement("style");
    style.id = "reviseiq-copy-button-style";
    style.textContent = `
      .page-header .copy-page-btn {
        position: absolute;
        top: 4px;
        right: 36px;
        min-height: 30px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 5px 10px;
        border: 1px solid var(--border);
        border-radius: var(--radius-s);
        background: var(--card-bg);
        color: var(--text-soft);
        box-shadow: var(--shadow-s);
        font-size: 12px;
        font-weight: 600;
        line-height: 1;
        opacity: 0;
        transform: translateY(-2px);
        transition: opacity .12s ease, transform .12s ease, background .12s ease, border-color .12s ease, color .12s ease;
        z-index: 2;
      }
      .page-header:hover .copy-page-btn,
      .page-header .copy-page-btn:focus-visible,
      .page-header .copy-page-btn.is-copied,
      .page-header .copy-page-btn.is-copy-error {
        opacity: 1;
        transform: translateY(0);
      }
      .page-header .copy-page-btn:hover {
        border-color: var(--border-strong);
        background: var(--bg-soft);
        color: var(--text);
      }
      .page-header .copy-page-btn.is-copied {
        color: var(--success);
        border-color: var(--success);
        background: var(--success-soft);
      }
      .page-header .copy-page-btn.is-copy-error {
        color: var(--danger);
        border-color: var(--danger);
        background: var(--danger-soft);
      }
      @media (max-width: 640px) {
        .page-header .copy-page-btn {
          right: 34px;
          padding: 5px 8px;
        }
        .page-header .copy-page-btn span {
          display: none;
        }
      }
    `;
    document.head.appendChild(style);

    document.addEventListener("click", (event) => {
      const button = event.target.closest ? event.target.closest("#copy-page-notes-btn") : null;
      if (!button) return;
      const run = async () => {
        try {
          const { getPage } = await import("./state.js");
          const page = getPage(button.dataset.pageId);
          if (!page || !navigator.clipboard || !window.ClipboardItem) return;
          const html = buildReviseIqClipboardHtml(page);
          const text = REVISEIQ_CLIPBOARD_TEXT_MARKER + clipboardPlainTextFromHtml(html);
          const payload = JSON.stringify({ version: 1, kind: "reviseiq-notes", title: page.title || "", blocks: page.blocks || [] });
          const item = new ClipboardItem({
            [REVISEIQ_CLIPBOARD_MIME]: new Blob([payload], { type: REVISEIQ_CLIPBOARD_MIME }),
            "text/html": new Blob([html], { type: "text/html" }),
            "text/plain": new Blob([text], { type: "text/plain" })
          });
          await navigator.clipboard.write([item]);
        } catch (e) {
          /* The existing copy handler remains the fallback. */
        }
      };
      run();
    });

    document.addEventListener("paste", (event) => {
      const target = event.target && event.target.closest ? event.target.closest(".rt") : null;
      if (!target || !event.clipboardData) return;

      const custom = event.clipboardData.getData(REVISEIQ_CLIPBOARD_MIME);
      const text = event.clipboardData.getData("text/plain") || "";
      const html = event.clipboardData.getData("text/html") || "";
      const marked = text.indexOf(REVISEIQ_CLIPBOARD_TEXT_MARKER) === 0;
      if (!custom && !marked) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      const run = async () => {
        try {
          let blocks = [];
          if (custom) {
            const data = JSON.parse(custom);
            if (data && data.version === 1 && data.kind === "reviseiq-notes" && Array.isArray(data.blocks)) blocks = data.blocks;
          }
          if (!blocks.length && html) blocks = htmlToBlocks(html);
          if (!blocks.length) return;
          await insertClipboardBlocks(target, blocks);
        } catch (e) {
          /* Leave malformed clipboard data alone rather than damaging notes. */
        }
      };
      run();
    }, true);
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true });
  else install();
}

installClipboardRoundTrip();
