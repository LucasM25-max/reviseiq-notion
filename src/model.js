// Pure data model: block/page factories, default state, state normalisation.
import { uid } from "./utils.js";
import {
  normalizeIconKey,
  subjectIconForTitle,
  DEFAULT_PAGE_ICON,
  DEFAULT_CALLOUT_ICON
} from "./icons.js";

export function newBlock(type) {
  const b = { id: uid(), type };
  switch (type) {
    case "paragraph":
    case "heading1":
    case "heading2":
    case "heading3":
    case "quote":
    case "bulleted":
    case "numbered":
      b.content = "";
      break;
    case "todo":
      b.content = "";
      b.checked = false;
      break;
    case "callout":
      b.content = "";
      b.icon = DEFAULT_CALLOUT_ICON;
      break;
    case "code":
      b.content = "";
      b.lang = "";
      break;
    case "divider":
      break;
    case "table":
      b.rows = [["", ""], ["", ""]];
      break;
    case "toggle":
      b.summary = "";
      b.collapsed = false;
      b.children = [newBlock("paragraph")];
      break;
    case "image":
      b.src = null;
      b.caption = "";
      break;
    case "video":
      b.videoId = null;
      break;
    case "page":
      b.childPageId = null;
      break;
    default:
      b.content = "";
  }
  return b;
}

export function newPageObject(opts) {
  return {
    id: uid(),
    parentId: opts.parentId || null,
    type: opts.type,
    title: opts.title || "",
    icon:
      normalizeIconKey(opts.icon, null) ||
      (opts.type === "subject" ? subjectIconForTitle(opts.title || "") : DEFAULT_PAGE_ICON),
    examBoard: opts.type === "subject" ? null : undefined,
    examBoardOther: opts.type === "subject" ? "" : undefined,
    examDates: opts.type === "subject" ? [] : undefined,
    blocks: [newBlock("paragraph")],
    createdAt: Date.now()
  };
}

export function createDefaultState() {
  return { pages: {}, rootPageIds: [], activePageId: null, expanded: {} };
}

/* Older saves stored emoji icons; convert them to the custom icon set. */
function migrateBlockIcons(blocks) {
  if (!Array.isArray(blocks)) return;
  blocks.forEach((b) => {
    if (!b || typeof b !== "object") return;
    if (b.type === "callout") b.icon = normalizeIconKey(b.icon, DEFAULT_CALLOUT_ICON);
    if (b.type === "toggle") migrateBlockIcons(b.children);
  });
}

export function normalizeState(obj) {
  const s = createDefaultState();
  try {
    if (obj && typeof obj === "object") {
      if (obj.pages && typeof obj.pages === "object") s.pages = obj.pages;
      if (Array.isArray(obj.rootPageIds)) s.rootPageIds = obj.rootPageIds;
      if (typeof obj.activePageId === "string") s.activePageId = obj.activePageId;
      if (obj.expanded && typeof obj.expanded === "object") s.expanded = obj.expanded;
    }
  } catch (e) {
    /* ignore malformed input */
  }
  for (const id in s.pages) {
    const p = s.pages[id];
    if (!Array.isArray(p.blocks) || p.blocks.length === 0) p.blocks = [newBlock("paragraph")];
    if (p.type === "subject" && !Array.isArray(p.examDates)) p.examDates = [];
    p.icon = normalizeIconKey(
      p.icon,
      p.type === "subject" ? subjectIconForTitle(p.title || "") : DEFAULT_PAGE_ICON
    );
    migrateBlockIcons(p.blocks);
  }
  return s;
}
