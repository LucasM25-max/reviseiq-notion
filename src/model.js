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
      b.children = [];
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
  return {
    pages: {},
    rootPageIds: [],
    activePageId: null,
    expanded: {},
    srs: {},
    reviewLog: {},
    // Mock exam attempts, keyed by id, and the examiner feedback kept from them.
    tests: {},
    insights: [],
    // Multiple-choice quiz attempts from "Quiz me".
    quizzes: {},
    // Revision planner: settings, generated schedule, and what you ticked off.
    plan: {}
  };
}

/* Older saves stored emoji icons; convert them to the custom icon set. */
function migrateBlockIcons(blocks) {
  if (!Array.isArray(blocks)) return;
  blocks.forEach((b) => {
    if (!b || typeof b !== "object") return;
    if (b.type === "callout") {
      b.icon = normalizeIconKey(b.icon, DEFAULT_CALLOUT_ICON);
      if (!Array.isArray(b.children)) b.children = [];
      migrateBlockIcons(b.children);
    }
    if (b.type === "toggle") migrateBlockIcons(b.children);
  });
}

function collectLinkedChildIds(blocks, set) {
  if (!Array.isArray(blocks)) return;
  blocks.forEach((b) => {
    if (!b || typeof b !== "object") return;
    if (b.type === "page" && b.childPageId) set.add(b.childPageId);
    if (b.type === "toggle" || b.type === "callout") collectLinkedChildIds(Array.isArray(b.children) ? b.children : [], set);
  });
}

/*
 * Subpages are now shown only as inline page blocks, so every child page must
 * have a block in its parent. Older saves (and pages created before this
 * change) can be missing one — append it so nothing becomes unreachable.
 */
function ensureInlineSubpages(pages) {
  const linkedByParent = {};
  for (const id in pages) {
    const set = new Set();
    collectLinkedChildIds(pages[id].blocks, set);
    linkedByParent[id] = set;
  }
  const orphans = {};
  for (const id in pages) {
    const p = pages[id];
    if (!p.parentId || !pages[p.parentId]) continue;
    if (linkedByParent[p.parentId] && linkedByParent[p.parentId].has(id)) continue;
    (orphans[p.parentId] = orphans[p.parentId] || []).push(p);
  }
  for (const parentId in orphans) {
    orphans[parentId]
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
      .forEach((child) => {
        pages[parentId].blocks.push({ id: uid(), type: "page", childPageId: child.id });
      });
  }
}

export function normalizeState(obj) {
  const s = createDefaultState();
  try {
    if (obj && typeof obj === "object") {
      if (obj.pages && typeof obj.pages === "object") s.pages = obj.pages;
      if (Array.isArray(obj.rootPageIds)) s.rootPageIds = obj.rootPageIds;
      if (typeof obj.activePageId === "string") s.activePageId = obj.activePageId;
      if (obj.expanded && typeof obj.expanded === "object") s.expanded = obj.expanded;
      if (obj.srs && typeof obj.srs === "object") s.srs = obj.srs;
      if (obj.reviewLog && typeof obj.reviewLog === "object") s.reviewLog = obj.reviewLog;
      if (obj.tests && typeof obj.tests === "object") s.tests = obj.tests;
      if (Array.isArray(obj.insights)) s.insights = obj.insights;
      if (obj.quizzes && typeof obj.quizzes === "object") s.quizzes = obj.quizzes;
      if (obj.plan && typeof obj.plan === "object") s.plan = obj.plan;
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
  ensureInlineSubpages(s.pages);
  return s;
}
