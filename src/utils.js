// Small shared helpers: ids, escaping, sanitising, dates, media.

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

export function escapeHtml(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
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
