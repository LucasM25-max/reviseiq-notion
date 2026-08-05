/*
 * The flashcard library.
 *
 * Cards used to live in the notes as toggle blocks, which meant every card the
 * AI wrote landed in the middle of the page you were trying to read. Cards now
 * live in their own store and are shown on the Flashcards page instead.
 *
 * There are exactly two ways a card comes into existence:
 *
 *   1. A key term block in your notes. The block is the card - edit the block
 *      and the card changes with it, delete the block and the card goes.
 *   2. Getting something wrong in a quiz, practise or mock, which writes a
 *      stored card here.
 *
 * Scheduling state (src/srs.js) is keyed by card id, and a migrated card keeps
 * the id its toggle block had, so review history survives the move.
 */
import { store, getPage, getAllDescendantIds } from "./state.js";
import { uid } from "./utils.js";

export function ensureCards() {
  if (!store.state.cards || typeof store.state.cards !== "object") store.state.cards = {};
  return store.state.cards;
}

function plain(html) {
  return String(html || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** Loose match used for de-duplication. */
export function cardKey(front) {
  return plain(front)
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pageBits(pageId) {
  const p = getPage(pageId);
  return {
    pageId: pageId,
    pageTitle: p ? p.title || "Untitled" : "Untitled",
    pageIcon: p ? p.icon : null
  };
}

/* ---------- key term blocks ---------- */

/** The answer side of a key term block, as blocks the card renderer understands. */
export function definitionAnswer(block) {
  const out = [{ type: "paragraph", content: block.definition || "" }];
  if (plain(block.example)) out.push({ type: "paragraph", content: "<em>e.g.</em> " + block.example });
  return out;
}

function walkDefinitions(blocks, page, out) {
  if (!Array.isArray(blocks)) return;
  blocks.forEach((b) => {
    if (!b || typeof b !== "object") return;
    if (b.type === "definition") {
      // Half-written blocks are notes in progress, not cards to be tested on.
      if (plain(b.term) && plain(b.definition)) {
        out.push({
          id: b.id,
          pageId: page.id,
          pageTitle: page.title || "Untitled",
          pageIcon: page.icon,
          question: b.term || "",
          answer: definitionAnswer(b),
          source: "term",
          inNotes: true
        });
      }
    }
    if (Array.isArray(b.children)) walkDefinitions(b.children, page, out);
  });
}

/* ---------- stored cards ---------- */

function hydrate(raw) {
  if (!raw || !raw.id) return null;
  const bits = pageBits(raw.pageId);
  return {
    id: raw.id,
    pageId: raw.pageId,
    pageTitle: bits.pageTitle,
    pageIcon: bits.pageIcon,
    question: raw.front || "",
    answer: Array.isArray(raw.blocks) && raw.blocks.length ? raw.blocks : [{ type: "paragraph", content: raw.back || "" }],
    topic: raw.topic || "",
    source: raw.source || "mistake",
    createdAt: raw.createdAt || 0,
    inNotes: false
  };
}

/**
 * cfg: { pageId, front, back, blocks?, topic?, source?, fromAttempt? }
 * Returns the stored card, or null if it has no front.
 */
export function createCard(cfg) {
  const cards = ensureCards();
  const front = String(cfg.front || "").trim();
  if (!front || !cfg.pageId) return null;
  const id = cfg.id || uid();
  cards[id] = {
    id: id,
    pageId: cfg.pageId,
    front: front,
    back: String(cfg.back || ""),
    blocks: Array.isArray(cfg.blocks) ? cfg.blocks : null,
    topic: cfg.topic || "",
    source: cfg.source || "mistake",
    fromAttempt: cfg.fromAttempt || null,
    createdAt: cfg.createdAt || Date.now()
  };
  return cards[id];
}

export function getStoredCard(id) {
  return ensureCards()[id] || null;
}

export function deleteCard(id) {
  const cards = ensureCards();
  if (!cards[id]) return false;
  delete cards[id];
  if (store.state.srs) delete store.state.srs[id];
  return true;
}

/** Cards whose page no longer exists are dropped. */
function storedForPages(ids) {
  const cards = ensureCards();
  const want = ids ? new Set(ids) : null;
  const out = [];
  for (const id in cards) {
    const raw = cards[id];
    if (!raw || !getPage(raw.pageId)) continue;
    if (want && !want.has(raw.pageId)) continue;
    const card = hydrate(raw);
    if (card) out.push(card);
  }
  return out;
}

/* ---------- the two collectors everything else uses ---------- */

/** Cards on one page plus all of its subpages. */
export function cardsForPage(pageId) {
  const ids = [pageId].concat(getAllDescendantIds(pageId));
  const out = storedForPages(ids);
  ids.forEach((id) => {
    const p = getPage(id);
    if (p) walkDefinitions(p.blocks, p, out);
  });
  return out;
}

/** Every card in the workspace. */
export function allCards() {
  const out = storedForPages(null);
  for (const id in store.state.pages) {
    const p = store.state.pages[id];
    walkDefinitions(p.blocks, p, out);
  }
  return out;
}

/** Fronts already in the library, so a repeated mistake resurfaces a card. */
export function ownedFronts(pageId) {
  const map = new Map();
  const list = pageId ? cardsForPage(pageId) : allCards();
  list.forEach((c) => {
    const key = cardKey(c.question);
    if (key && !map.has(key)) map.set(key, c.id);
  });
  return map;
}

/* ---------- moving old toggle cards into the library ---------- */

const OLD_CARDS_HEADING = "flashcards from your mistakes";

function blocksToBackHtml(blocks) {
  return (blocks || [])
    .map((b) => (b && typeof b.content === "string" ? b.content : ""))
    .filter((t) => plain(t))
    .join("<br>");
}

function liftToggles(blocks, page, made) {
  if (!Array.isArray(blocks)) return blocks;
  const kept = [];
  blocks.forEach((b) => {
    if (!b || typeof b !== "object") return;
    if (b.type === "toggle" && plain(b.summary)) {
      createCard({
        id: b.id,
        pageId: page.id,
        front: b.summary,
        back: blocksToBackHtml(b.children),
        blocks: Array.isArray(b.children) ? b.children : null,
        topic: b.cardTopic || "",
        source: b.fromAttempt ? "mistake" : "note",
        fromAttempt: b.fromAttempt || null
      });
      made.count += 1;
      return; // the block itself leaves the notes
    }
    if (b.type === "heading2" && plain(b.content).toLowerCase() === OLD_CARDS_HEADING) return;
    if (Array.isArray(b.children)) b.children = liftToggles(b.children, page, made);
    kept.push(b);
  });
  return kept;
}

/**
 * One-off: every toggle block that was acting as a flashcard becomes a stored
 * card and leaves the notes. Runs once per workspace, so toggles created after
 * this are just toggles.
 */
export function migrateNoteCards() {
  ensureCards();
  if (store.state.cardsMigrated) return 0;
  const made = { count: 0 };
  for (const id in store.state.pages) {
    const p = store.state.pages[id];
    p.blocks = liftToggles(p.blocks, p, made);
    if (!p.blocks.length) p.blocks = [{ id: uid(), type: "paragraph", content: "" }];
  }
  store.state.cardsMigrated = Date.now();
  return made.count;
}
