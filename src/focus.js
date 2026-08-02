// Caret / selection helpers for the contenteditable blocks.

export function focusBlock(blockId, atEnd) {
  if (!blockId) return;
  const row = document.querySelector('.block-row[data-block-id="' + blockId + '"]');
  if (!row) return;
  let editable = row.querySelector(".block-content > .rt, .block-content .toggle-row > .rt, .block-content .list-row > .rt");
  if (!editable) editable = row.querySelector("[contenteditable]");
  if (!editable) return;
  editable.focus();
  if (atEnd) {
    const range = document.createRange();
    range.selectNodeContents(editable);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

export function focusBlockAtOffset(blockId, textOffset) {
  const row = document.querySelector('.block-row[data-block-id="' + blockId + '"]');
  if (!row) return;
  const el = row.querySelector(".rt");
  if (!el) return;
  el.focus();
  const sel = window.getSelection();
  const range = document.createRange();
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
  let node;
  let count = 0;
  let target = null;
  let targetOffset = 0;
  while ((node = walker.nextNode())) {
    const len = node.nodeValue.length;
    if (count + len >= textOffset) {
      target = node;
      targetOffset = textOffset - count;
      break;
    }
    count += len;
  }
  if (target) range.setStart(target, targetOffset);
  else {
    range.selectNodeContents(el);
    range.collapse(false);
  }
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

export function isCursorAtStart(el) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return false;
  const range = sel.getRangeAt(0);
  const pre = range.cloneRange();
  pre.selectNodeContents(el);
  pre.setEnd(range.startContainer, range.startOffset);
  return pre.toString().length === 0;
}

export function splitAtCursor(el) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return { before: el.innerHTML, after: "" };
  const range = sel.getRangeAt(0);
  const afterRange = range.cloneRange();
  afterRange.selectNodeContents(el);
  afterRange.setStart(range.endContainer, range.endOffset);
  const frag = afterRange.extractContents();
  const tmp = document.createElement("div");
  tmp.appendChild(frag);
  return { before: el.innerHTML, after: tmp.innerHTML };
}

export function normalizeEmptyContent(html) {
  if (html === "<br>" || html === "\u200b") return "";
  return html;
}
