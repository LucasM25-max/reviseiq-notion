// Single mutable store plus read-only queries over it.
import { createDefaultState } from "./model.js";

export const store = {
  state: createDefaultState(),
  currentView: "page" // "page" | "calendar"
};

export function getState() {
  return store.state;
}

export function setState(next) {
  store.state = next;
}

export function getCurrentView() {
  return store.currentView;
}

export function setCurrentView(view) {
  store.currentView = view;
}

export function getPage(id) {
  return id ? store.state.pages[id] : null;
}

export function getActivePage() {
  return getPage(store.state.activePageId);
}

export function getChildren(pageId) {
  const arr = [];
  for (const id in store.state.pages) {
    if (store.state.pages[id].parentId === pageId) arr.push(store.state.pages[id]);
  }
  arr.sort((a, b) => a.createdAt - b.createdAt);
  return arr;
}

export function getAllDescendantIds(pageId) {
  let out = [];
  const kids = getChildren(pageId);
  for (let i = 0; i < kids.length; i++) {
    out.push(kids[i].id);
    out = out.concat(getAllDescendantIds(kids[i].id));
  }
  return out;
}

export function getAncestors(pageId) {
  const chain = [];
  let p = getPage(pageId);
  while (p && p.parentId) {
    p = getPage(p.parentId);
    if (p) chain.unshift(p);
  }
  return chain;
}

/* ---- block tree lookups (including toggle children) ---- */

export function findContainer(blocks, blockId) {
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].id === blockId) return { arr: blocks, idx: i };
    if (blocks[i].type === "toggle" || blocks[i].type === "callout") {
      const kids = Array.isArray(blocks[i].children) ? blocks[i].children : [];
      const found = findContainer(kids, blockId);
      if (found) return found;
    }
  }
  return null;
}

export function findBlockById(blocks, blockId) {
  const c = findContainer(blocks, blockId);
  return c ? c.arr[c.idx] : null;
}

export function findPageBlockRef(page, childPageId) {
  function walk(blocks) {
    for (let i = 0; i < blocks.length; i++) {
      if (blocks[i].type === "page" && blocks[i].childPageId === childPageId) return { arr: blocks, idx: i };
      if (blocks[i].type === "toggle" || blocks[i].type === "callout") {
        const kids = Array.isArray(blocks[i].children) ? blocks[i].children : [];
        const f = walk(kids);
        if (f) return f;
      }
    }
    return null;
  }
  return walk(page.blocks);
}
