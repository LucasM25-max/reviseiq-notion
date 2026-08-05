// Block-level operations on the active page's block tree.
import { findContainer, findBlockById } from "./state.js";
import { newBlock, ITEM_BLOCKS } from "./model.js";
import { uid } from "./utils.js";

export function insertBlockAfter(page, afterBlockId, block) {
  const c = findContainer(page.blocks, afterBlockId);
  if (!c) {
    page.blocks.push(block);
    return;
  }
  c.arr.splice(c.idx + 1, 0, block);
}

export function deleteBlockById(page, blockId) {
  const c = findContainer(page.blocks, blockId);
  if (!c) return null;
  const prevId = c.idx > 0 ? c.arr[c.idx - 1].id : null;
  c.arr.splice(c.idx, 1);
  if (page.blocks.length === 0) page.blocks.push(newBlock("paragraph"));
  return prevId;
}

export function updateBlockField(page, blockId, patch) {
  const b = findBlockById(page.blocks, blockId);
  if (!b) return;
  for (const k in patch) b[k] = patch[k];
}

export function convertBlockType(page, blockId, newType) {
  const b = findBlockById(page.blocks, blockId);
  if (!b) return;
  const keepContent = b.content !== undefined ? b.content : b.summary !== undefined ? b.summary : "";
  // The block keeps its identity across a type change, so anything holding a
  // reference to it (revision records, links, focus) still resolves.
  const keepId = b.id;
  const freshDefaults = newBlock(newType);
  for (const k in b) delete b[k];
  for (const k in freshDefaults) b[k] = freshDefaults[k];
  b.id = keepId;
  if (b.content !== undefined) b.content = keepContent;
  if (b.summary !== undefined) b.summary = keepContent;
}

export function duplicateBlock(page, blockId) {
  const c = findContainer(page.blocks, blockId);
  if (!c) return;
  const clone = JSON.parse(JSON.stringify(c.arr[c.idx]));
  (function assignNewIds(bl) {
    bl.id = uid();
    if ((bl.type === "toggle" || bl.type === "callout") && Array.isArray(bl.children)) bl.children.forEach(assignNewIds);
    // Timeline entries, comparison pairs and process steps carry their own ids.
    const spec = ITEM_BLOCKS[bl.type];
    if (spec && Array.isArray(bl[spec.key])) bl[spec.key].forEach((it) => (it.id = uid()));
  })(clone);
  c.arr.splice(c.idx + 1, 0, clone);
}

export function moveBlock(containerArr, fromIdx, toIdx) {
  const item = containerArr.splice(fromIdx, 1)[0];
  containerArr.splice(toIdx, 0, item);
}

export function containerKeyFor(page, blockId) {
  function walk(blocks, key) {
    for (let i = 0; i < blocks.length; i++) {
      if (blocks[i].id === blockId) return key;
      if (blocks[i].type === "toggle") {
        const f = walk(blocks[i].children, "toggle:" + blocks[i].id);
        if (f) return f;
      }
      if (blocks[i].type === "callout") {
        const f = walk(Array.isArray(blocks[i].children) ? blocks[i].children : [], "callout:" + blocks[i].id);
        if (f) return f;
      }
    }
    return null;
  }
  return walk(page.blocks, "page:" + page.id);
}
