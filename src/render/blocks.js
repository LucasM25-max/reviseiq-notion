// Pure HTML rendering for blocks.
import { escapeHtml } from "../utils.js";
import { getPage, getChildren } from "../state.js";

export function renderBlocksList(blocks) {
  let html = "";
  let numberCounter = 0;
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].type !== "numbered") numberCounter = 0;
    else numberCounter++;
    html += renderBlock(blocks[i], numberCounter);
  }
  return html;
}

export function renderBlock(block, numberIndex) {
  let inner = "";
  switch (block.type) {
    case "paragraph":
      inner = '<div class="rt" contenteditable="true" data-placeholder="Type &#39;/&#39; for commands">' + block.content + "</div>";
      break;
    case "heading1":
      inner = '<div class="rt b-h1" contenteditable="true" data-placeholder="Heading 1">' + block.content + "</div>";
      break;
    case "heading2":
      inner = '<div class="rt b-h2" contenteditable="true" data-placeholder="Heading 2">' + block.content + "</div>";
      break;
    case "heading3":
      inner = '<div class="rt b-h3" contenteditable="true" data-placeholder="Heading 3">' + block.content + "</div>";
      break;
    case "quote":
      inner = '<div class="rt b-quote" contenteditable="true" data-placeholder="Quote">' + block.content + "</div>";
      break;
    case "bulleted":
      inner =
        '<div class="list-row"><div class="list-marker bullet"></div><div class="rt" contenteditable="true" data-placeholder="List item" style="flex:1;">' +
        block.content +
        "</div></div>";
      break;
    case "numbered":
      inner =
        '<div class="list-row"><div class="list-marker">' +
        numberIndex +
        '.</div><div class="rt" contenteditable="true" data-placeholder="List item" style="flex:1;">' +
        block.content +
        "</div></div>";
      break;
    case "todo":
      inner =
        '<div class="list-row"><div class="todo-check' +
        (block.checked ? " checked" : "") +
        '" data-todo-check="' +
        block.id +
        '">' +
        (block.checked ? "\u2713" : "") +
        '</div><div class="rt todo-text' +
        (block.checked ? " checked" : "") +
        '" contenteditable="true" data-placeholder="To-do" style="flex:1;">' +
        block.content +
        "</div></div>";
      break;
    case "callout":
      inner =
        '<div class="b-callout"><div class="callout-icon" data-callout-icon="' +
        block.id +
        '">' +
        block.icon +
        '</div><div class="rt" contenteditable="true" data-placeholder="Note it down..." style="flex:1;">' +
        block.content +
        "</div></div>";
      break;
    case "divider":
      inner = '<hr class="b-divider" />';
      break;
    case "code":
      inner =
        '<div class="code-wrap"><div class="code-lang"><input type="text" placeholder="plain text" value="' +
        escapeHtml(block.lang || "") +
        '" data-code-lang="' +
        block.id +
        '" /></div><textarea class="code-area" rows="3" data-code-area="' +
        block.id +
        '" spellcheck="false" placeholder="Write or paste code">' +
        escapeHtml(block.content || "") +
        "</textarea></div>";
      break;
    case "table":
      inner = renderTableBlock(block);
      break;
    case "toggle":
      inner =
        '<div class="toggle-row"><div class="toggle-arrow' +
        (block.collapsed ? " collapsed" : "") +
        '" data-toggle-arrow="' +
        block.id +
        '"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="6 9 12 15 18 9"/></svg></div>' +
        '<div class="rt" contenteditable="true" data-placeholder="Toggle" style="flex:1;font-weight:600;">' +
        block.summary +
        "</div></div>" +
        (block.collapsed
          ? ""
          : '<div class="toggle-children" data-toggle-children="' +
            block.id +
            '">' +
            renderBlocksList(block.children) +
            '<div class="add-block-row"><div class="add-block-ghost" data-add-in-toggle="' +
            block.id +
            '">+&nbsp; Add a block inside</div></div></div>');
      break;
    case "image":
      inner = renderImageBlock(block);
      break;
    case "video":
      inner = renderVideoBlock(block);
      break;
    case "page": {
      const cp = getPage(block.childPageId);
      if (!cp) {
        inner = "";
        break;
      }
      const n = getChildren(cp.id).length;
      inner =
        '<div class="b-page-row" data-nav="' +
        cp.id +
        '"><span class="icon">' +
        cp.icon +
        '</span><span class="title">' +
        escapeHtml(cp.title || "Untitled") +
        "</span>" +
        (n > 0 ? '<span class="sub" style="color:var(--text-faint);font-size:11.5px;">' + n + " subpage" + (n > 1 ? "s" : "") + "</span>" : "") +
        '<span class="arrow">\u2192</span></div>';
      break;
    }
    default:
      inner = "";
  }

  const showControls = block.type !== "divider";
  return (
    '<div class="block-row" data-block-id="' +
    block.id +
    '" data-block-type="' +
    block.type +
    '" draggable="false">' +
    (showControls
      ? '<div class="block-controls">' +
        '<button class="block-ctrl-btn plus" data-plus="' +
        block.id +
        '" title="Add block below"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>' +
        '<button class="block-ctrl-btn handle" data-handle="' +
        block.id +
        '" title="Drag to move, click for options" draggable="true"><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><circle cx="8" cy="5" r="1.4"/><circle cx="16" cy="5" r="1.4"/><circle cx="8" cy="12" r="1.4"/><circle cx="16" cy="12" r="1.4"/><circle cx="8" cy="19" r="1.4"/><circle cx="16" cy="19" r="1.4"/></svg></button>' +
        "</div>"
      : '<div class="block-controls"></div>') +
    '<div class="block-content">' +
    inner +
    "</div></div>"
  );
}

export function renderTableBlock(block) {
  let html = '<table class="b-table"><tbody>';
  block.rows.forEach((row, ri) => {
    html += "<tr>";
    row.forEach((cell, ci) => {
      html +=
        '<td contenteditable="true" data-table-cell="' + block.id + '" data-r="' + ri + '" data-c="' + ci + '">' + escapeHtml(cell) + "</td>";
    });
    html += "</tr>";
  });
  html +=
    "</tbody></table>" +
    '<div class="table-tools">' +
    '<button data-table-add-row="' + block.id + '">+ Row</button>' +
    '<button data-table-add-col="' + block.id + '">+ Column</button>' +
    '<button data-table-del-row="' + block.id + '">\u2212 Row</button>' +
    '<button data-table-del-col="' + block.id + '">\u2212 Column</button>' +
    "</div>";
  return html;
}

export function renderImageBlock(block) {
  if (!block.src) {
    return (
      '<div class="b-image-empty" data-image-drop="' +
      block.id +
      '"><div>\uD83D\uDDBC\uFE0F</div><div>Click to upload, or paste an image</div>' +
      '<button data-image-upload="' +
      block.id +
      '">Upload image</button>' +
      '<input type="file" accept="image/*" data-image-input="' +
      block.id +
      '" style="display:none;" /></div>'
    );
  }
  return (
    '<div class="b-image-wrap"><img src="' +
    block.src +
    '" alt="" />' +
    '<div class="b-image-caption" contenteditable="true" data-placeholder="Add a caption\u2026" data-image-caption="' +
    block.id +
    '">' +
    escapeHtml(block.caption || "") +
    "</div></div>"
  );
}

export function renderVideoBlock(block) {
  if (!block.videoId) {
    return (
      '<div><div class="b-video-empty">' +
      '<input type="text" placeholder="Paste a YouTube link\u2026" data-video-input="' +
      block.id +
      '" />' +
      '<button data-video-embed="' +
      block.id +
      '">Embed</button></div>' +
      '<div class="video-error" data-video-error="' +
      block.id +
      '" style="display:none;"></div></div>'
    );
  }
  return (
    '<div class="video-embed"><iframe src="https://www.youtube.com/embed/' +
    block.videoId +
    '" allowfullscreen allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"></iframe></div>'
  );
}
