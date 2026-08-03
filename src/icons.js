// Custom icon system for ReviseIQ.
// Page/callout icons are stored as short keys (e.g. "flask") and rendered as
// SVG files from /icons. UI chrome icons are inline SVG so they can inherit
// currentColor.

export const ICON_BASE = "/icons/";

/* Ordered so the picker groups sensibly: subjects, then study, then markers. */
export const ICON_KEYS = [
  "book", "notebook", "note", "page", "scroll", "quill", "pencil",
  "calculator", "dna", "flask", "atom", "microscope", "column", "globe",
  "chat", "palette", "music", "laptop", "briefcase", "mask", "ruler",
  "brain", "ball", "trophy", "graduation", "leaf", "rocket",
  "clock", "calendar", "checklist", "target", "flag", "pin", "key",
  "star", "flame", "bulb", "warning", "check",
  "exam", "marksheet", "stopwatch", "medal", "cards", "question", "chart"
];

export const CALLOUT_ICON_KEYS = ["bulb", "pin", "warning", "check", "note", "key", "star", "flame"];

export const DEFAULT_PAGE_ICON = "page";
export const DEFAULT_SUBJECT_ICON = "book";
export const DEFAULT_CALLOUT_ICON = "bulb";

const KEY_SET = new Set(ICON_KEYS);

/* Icons used to be emoji. Map every legacy value onto the new set so saved
   workspaces keep a sensible icon after upgrading. */
const LEGACY_EMOJI = {
  "\ud83d\udcd8": "book", "\ud83d\udcd7": "book", "\ud83d\udcd9": "book",
  "\ud83d\udcda": "book", "\ud83d\udcd6": "book", "\ud83d\udcdd": "pencil",
  "\u270f": "pencil", "\ud83d\udcd0": "ruler", "\ud83e\uddea": "flask",
  "\u2697": "flask", "\ud83d\udd2c": "microscope", "\ud83e\uddec": "dna",
  "\u269b": "atom", "\ud83d\udd22": "calculator", "\ud83c\udf0d": "globe",
  "\ud83c\udfdb": "column", "\ud83c\udfa8": "palette", "\ud83c\udfb5": "music",
  "\ud83c\udfad": "mask", "\ud83d\udcbb": "laptop", "\ud83d\udcbc": "briefcase",
  "\u26bd": "ball", "\ud83e\udde0": "brain", "\ud83d\ude4f": "scroll",
  "\ud83d\udd2d": "rocket", "\ud83e\uddf2": "target", "\ud83c\udf1f": "star",
  "\u2728": "star", "\u2b50": "star", "\ud83d\udcaa": "trophy",
  "\u23f0": "clock", "\ud83c\udfaf": "target", "\u2705": "check",
  "\ud83d\udd25": "flame", "\ud83d\udca1": "bulb", "\ud83d\udcce": "pin",
  "\ud83d\udccc": "pin", "\ud83d\uddc2": "note", "\ud83c\udf93": "graduation",
  "\ud83d\udcc4": "page", "\ud83d\udde3": "chat", "\ud83d\udcc5": "calendar",
  "\u26a0": "warning", "\u2757": "warning", "\ud83d\udd11": "key",
  "\ud83c\udf31": "leaf", "\ud83d\ude80": "rocket", "\ud83c\udff3": "flag"
};

/** Accepts a new key, a legacy emoji, or junk, and always returns a valid key. */
export function normalizeIconKey(value, fallback) {
  const fb = fallback || DEFAULT_PAGE_ICON;
  if (!value || typeof value !== "string") return fb;
  if (KEY_SET.has(value)) return value;
  const stripped = value.replace(/[\uFE0F\u200D]/g, "");
  if (KEY_SET.has(stripped)) return stripped;
  return LEGACY_EMOJI[stripped] || LEGACY_EMOJI[value] || fb;
}

export function iconUrl(value, fallback) {
  return ICON_BASE + normalizeIconKey(value, fallback) + ".svg";
}

/**
 * Renders an icon as an <img>. `size` is a CSS length applied inline so the
 * same helper works for 16px tree rows and 44px page headers.
 */
export function iconImg(value, size, extraClass, fallback) {
  const px = size || 18;
  const cls = "app-icon" + (extraClass ? " " + extraClass : "");
  return (
    '<img class="' + cls + '" src="' + iconUrl(value, fallback) + '" alt="" draggable="false" ' +
    'style="width:' + px + "px;height:" + px + 'px;" />'
  );
}

/* ---------- inline UI icons (inherit currentColor) ---------- */

function svg(body, size, strokeWidth) {
  return (
    '<svg class="ui-icon" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="' + strokeWidth + '" stroke-linecap="round" stroke-linejoin="round">' +
    body +
    "</svg>"
  );
}

const UI_PATHS = {
  chevron: '<polyline points="6 9 12 15 18 9"/>',
  chevronRight: '<polyline points="9 6 15 12 9 18"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  minus: '<line x1="5" y1="12" x2="19" y2="12"/>',
  arrowRight: '<line x1="4" y1="12" x2="19" y2="12"/><polyline points="13 6 19 12 13 18"/>',
  close: '<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>',
  trash: '<path d="M4 7h16M10 4h4M6 7l1 13h10l1-13M10 11v6M14 11v6"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3.5v3M16 3.5v3"/>',
  list: '<path d="M4 6h10M4 12h16M4 18h12"/>',
  link: '<path d="M10 13.5a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1 1"/><path d="M14 10.5a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1-1"/>',
  check: '<polyline points="5 12.5 10 17.5 19 7"/>',
  image: '<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="m5 17 4.5-4.5 3.5 3.5 2.5-2.5L20 17"/>',
  play: '<circle cx="12" cy="12" r="8.5"/><path d="m10.3 8.8 5.2 3.2-5.2 3.2z"/>',
  text: '<path d="M5 6h14M9 6v12M12 18H6"/>',
  quote: '<path d="M9 6.5C6.5 8 5.5 10 5.5 12.8V17.5h5V12h-3c0-2 .8-3.4 2.4-4.3zM19 6.5c-2.5 1.5-3.5 3.5-3.5 6.3v4.7h5V12h-3c0-2 .8-3.4 2.4-4.3z"/>',
  bullet: '<circle cx="6" cy="12" r="1.8" fill="currentColor" stroke="none"/><path d="M11 12h9"/>',
  numbered: '<path d="M5.5 7.5 7 6.5v5M11 8h9M11 16h9M5 14.5h3l-3 3h3"/>',
  todo: '<rect x="3.5" y="4.5" width="9" height="9" rx="2"/><path d="m5.8 9 1.8 1.8 3-3.4M16 9h5M8 18h13"/>',
  toggle: '<polyline points="9 6 15 12 9 18"/>',
  flashcard: '<rect x="3" y="6" width="14" height="11" rx="2"/><path d="M7 3.8h11.5A2.5 2.5 0 0 1 21 6.3v10"/><path d="M7.5 10.5h5M7.5 13.5h3"/>',
  download: '<path d="M12 4v11"/><polyline points="7.5 10.5 12 15 16.5 10.5"/><path d="M4.5 19h15"/>',
  upload: '<path d="M12 19V8"/><polyline points="7.5 12.5 12 8 16.5 12.5"/><path d="M4.5 20h15"/>',
  code: '<polyline points="9 8 5 12 9 16"/><polyline points="15 8 19 12 15 16"/>',
  table: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M3.5 10h17M3.5 15h17M9.5 5v14"/>',
  divider: '<path d="M4 12h16"/>',
  flag: '<path d="M6 20.5V3.8"/><path d="M6 4.4h9.6l-1.9 3.6 1.9 3.6H6"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.2"/><circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none"/>',
  stopwatch: '<circle cx="12" cy="13.6" r="7.2"/><path d="M12 10v3.6l2.3 1.4"/><path d="M9.7 3h4.6M12 3v2.5"/><path d="m18.6 7 1.3-1.3"/>',
  medal: '<circle cx="12" cy="15.2" r="5.2"/><path d="m9.5 10.6-3-7.4h4.1L12 8.1"/><path d="m14.5 10.6 3-7.4h-4.1L12 8.1"/>',
  cards: '<rect x="3" y="7.8" width="13" height="9.8" rx="2" transform="rotate(-7 9.5 12.7)"/><rect x="7.2" y="6.4" width="13.6" height="10.2" rx="2"/><path d="M10.4 10h7.2M10.4 12.8h4.8"/>',
  exam: '<path d="M6.4 3.4h7.4L18 7.1v13.5H6.4z"/><path d="M13.6 3.4v3.7h4.3"/><path d="m9 12.4 1.4 1.4 2.7-2.9"/><path d="M9 17h6.4"/>',
  question: '<circle cx="12" cy="12" r="8.4"/><path d="M9.7 9.7a2.4 2.4 0 0 1 4.7.6c0 1.6-2.3 1.9-2.3 3.4"/><path d="M12 17h.01"/>',
  chart: '<path d="M4.2 20h15.6"/><path d="M7.4 20v-6.2M12 20V8.6M16.6 20V4.9"/>',
  cloud: '<path d="M7.3 18.5h9.5a3.7 3.7 0 0 0 .5-7.37 5.3 5.3 0 0 0-10.2-1.2A3.9 3.9 0 0 0 7.3 18.5Z"/>',
  cloudCheck: '<path d="M7.3 17.6h9.5a3.7 3.7 0 0 0 .5-7.37 5.3 5.3 0 0 0-10.2-1.2A3.9 3.9 0 0 0 7.3 17.6Z"/><polyline points="9.6 13.2 11.2 14.8 14.6 11.2"/>',
  refresh: '<path d="M19.4 11.2a7.4 7.4 0 1 0-.7 4.6"/><polyline points="19.6 6.2 19.6 11.4 14.4 11.4"/>',
  signout: '<path d="M14.6 4.6H7.2A1.6 1.6 0 0 0 5.6 6.2v11.6a1.6 1.6 0 0 0 1.6 1.6h7.4"/><polyline points="15.6 8.6 19.4 12 15.6 15.4"/><path d="M19.4 12h-8.6"/>',
  quiz: '<rect x="3.5" y="4.5" width="13" height="15" rx="2"/><path d="M7.5 3.2h9A2.3 2.3 0 0 1 18.8 5.5v11"/><path d="M6.8 9.2h6M6.8 12.4h4"/><polyline points="6.6 15.8 8 17.2 10.8 14.4"/>',
  bulb: '<path d="M9 17.5h6M10 20.5h4"/><path d="M12 3.5a5.5 5.5 0 0 0-3.2 9.98c.5.36.8.93.8 1.54v.48h4.8v-.48c0-.61.3-1.18.8-1.54A5.5 5.5 0 0 0 12 3.5Z"/>',
  warning: '<path d="M12 4.6 21 19.4H3z"/><path d="M12 10v4.2"/><circle cx="12" cy="16.8" r="1" fill="currentColor" stroke="none"/>',
  flame: '<path d="M12 3.5c2.6 3 4 5.2 4 7a4 4 0 0 1-8 0c0-.9.3-1.8 1-2.8-.2 3 1.5 3.4 1.5 1.3 0-1.8.5-3.6 1.5-5.5Z"/><path d="M6.5 13.5a5.5 5.5 0 1 0 11 0c0 3-2 4.5-2 4.5"/>',
  page: '<path d="M6.5 3.8h6L18 9v11.2H6.5z"/><path d="M12.5 3.8V9H18"/>',
  drag: '<circle cx="9" cy="5.5" r="1.5" fill="currentColor" stroke="none"/><circle cx="15" cy="5.5" r="1.5" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="9" cy="18.5" r="1.5" fill="currentColor" stroke="none"/><circle cx="15" cy="18.5" r="1.5" fill="currentColor" stroke="none"/>',
  heading1: '<path d="M4 6v12M12 6v12M4 12h8M16 18V8l-2.4 1.6"/>',
  heading2: '<path d="M4 6v12M11 6v12M4 12h7M15 9.5a2.5 2.5 0 0 1 5 0c0 2.5-5 3.5-5 8.5h5"/>',
  heading3: '<path d="M4 6v12M11 6v12M4 12h7M15 8.5h5l-3 3.5a2.8 2.8 0 1 1-2.2 4.6"/>'
};

export function ui(name, size, strokeWidth) {
  const body = UI_PATHS[name];
  if (!body) return "";
  return svg(body, size || 16, strokeWidth || 1.9);
}

/* ---------- subject icon guessing ---------- */

const SUBJECT_ICON_MAP = [
  [/math|maths|statistic/i, "calculator"],
  [/bio/i, "dna"],
  [/chem/i, "flask"],
  [/phys(?!ical education)/i, "atom"],
  [/science/i, "microscope"],
  [/english|literature/i, "quill"],
  [/histor/i, "column"],
  [/geog/i, "globe"],
  [/french|spanish|german|italian|mandarin|latin|language/i, "chat"],
  [/art\b|photograph/i, "palette"],
  [/music/i, "music"],
  [/comput|\bict\b|\bit\b|coding/i, "laptop"],
  [/\bpe\b|physical education|sport/i, "ball"],
  [/religio|\brs\b|philosoph|ethic/i, "scroll"],
  [/business|econom/i, "briefcase"],
  [/drama|theatre|theater/i, "mask"],
  [/design|\bdt\b|engineer|graphic/i, "ruler"],
  [/psycholog|sociolog/i, "brain"],
  [/food|cook|nutrition/i, "leaf"]
];

export function subjectIconForTitle(title) {
  const t = String(title || "");
  for (let i = 0; i < SUBJECT_ICON_MAP.length; i++) {
    if (SUBJECT_ICON_MAP[i][0].test(t)) return SUBJECT_ICON_MAP[i][1];
  }
  return DEFAULT_SUBJECT_ICON;
}
