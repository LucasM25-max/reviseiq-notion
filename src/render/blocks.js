// Pure HTML rendering for blocks.
import { escapeHtml, sanitizeHtmlFragment } from "../utils.js";
import { getPage, getChildren } from "../state.js";
import { iconImg, ui, DEFAULT_CALLOUT_ICON } from "../icons.js";

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
        (block.checked ? ui("check", 11, 3) : "") +
        '</div><div class="rt todo-text' +
        (block.checked ? " checked" : "") +
        '" contenteditable="true" data-placeholder="To-do" style="flex:1;">' +
        block.content +
        "</div></div>";
      break;
        case "callout": {
      const calloutKids = Array.isArray(block.children) ? block.children : [];
      const calloutBody = calloutKids.length
        ? renderBlocksList(calloutKids)
        : '<div class="add-block-row"><div class="add-block-ghost" data-add-in-callout="' + block.id + '">'  +
          ui('plus', 13, 2.2) + ' Add a block</div></div>';
      inner =
        '<div class="b-callout-wrap">'  +
        '<div class="b-callout-header">'  +
        '<button type="button" class="callout-icon" data-callout-icon="' + block.id + '" title="Change icon">'  +
        iconImg(block.icon, 19, "", DEFAULT_CALLOUT_ICON) +
        '</button>'  +
        '<div class="rt" contenteditable="true" data-placeholder="Callout title…" style="flex:1;font-weight:600;">'  +
        block.content +
        '</div></div>'  +
        '<div class="callout-children" data-callout-children="' + block.id + '">'  +
        calloutBody +
        '</div></div>';
      break;
    }
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
    case "timeline":
      inner = renderTimelineBlock(block);
      break;
    case "definition":
      inner = renderDefinitionBlock(block);
      break;
    case "comparison":
      inner = renderComparisonBlock(block);
      break;
    case "process":
      inner = renderProcessBlock(block);
      break;
    case "source":
      inner = renderSourceBlock(block);
      break;
    case "statistic":
      inner = renderStatisticBlock(block);
      break;
    case "toggle":
      inner =
        '<div class="toggle-row"><div class="toggle-arrow' +
        (block.collapsed ? " collapsed" : "") +
        '" data-toggle-arrow="' +
        block.id +
        '">' +
        ui("chevron", 12, 2.6) +
        "</div>" +
        '<div class="rt" contenteditable="true" data-placeholder="Toggle heading" style="flex:1;font-weight:600;">' +
        block.summary +
        "</div></div>" +
        (block.collapsed
          ? ""
          : '<div class="toggle-children" data-toggle-children="' +
            block.id +
            '">' +
            renderBlocksList(block.children) +
            (block.children && block.children.length
              ? ""
              : '<div class="add-block-row"><div class="add-block-ghost" data-add-in-toggle="' +
                block.id +
                '">' +
                ui("plus", 13, 2.2) +
                " Add a block</div></div>") +
            "</div>");
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
        iconImg(cp.icon, 18) +
        '</span><span class="title">' +
        escapeHtml(cp.title || "Untitled") +
        "</span>" +
        (n > 0 ? '<span class="sub" style="color:var(--text-faint);font-size:11.5px;">' + n + " subpage" + (n > 1 ? "s" : "") + "</span>" : "") +
        '<span class="arrow">' +
        ui("arrowRight", 15) +
        "</span></div>";
      break;
    }
    default:
      inner = "";
  }

  // Dividers get the same controls as every other block: without them there
  // is no way to move or delete one.
  const showControls = true;
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
        '" title="Add block below">' +
        ui("plus", 14, 2.2) +
        "</button>" +
        '<button class="block-ctrl-btn handle" data-handle="' +
        block.id +
        '" title="Drag to move, click for options" draggable="true">' +
        ui("drag", 14) +
        "</button>" +
        "</div>"
      : '<div class="block-controls"></div>') +
    '<div class="block-content">' +
    inner +
    "</div></div>"
  );
}

/*
 * A timeline: dated entries down a single rail.
 *
 * A bullet list loses the dates and a table forces every entry into the same
 * width, which is wrong when one event needs a clause and the next needs three
 * sentences. Here the date and the headline sit on one line and the detail runs
 * underneath at full width, so a dense chronology stays readable.
 */
export function renderTimelineBlock(block) {
  const items = Array.isArray(block.items) ? block.items : [];
  let html = '<div class="b-timeline" data-tl-block="' + block.id + '">';

  items.forEach((it) => {
    html +=
      '<div class="tl-item" data-tl-item="' + it.id + '">' +
      '<div class="tl-marker"><span class="tl-dot"></span></div>' +
      '<div class="tl-body">' +
      '<div class="tl-head">' +
      '<div class="tl-date" contenteditable="true" data-tl-field="date" data-placeholder="Date">' +
      sanitizeHtmlFragment(it.date || "") +
      "</div>" +
      '<div class="tl-title" contenteditable="true" data-tl-field="title" data-placeholder="What happened">' +
      sanitizeHtmlFragment(it.title || "") +
      "</div>" +
      '<button type="button" class="tl-del" data-tl-del="' + it.id + '" title="Remove this entry">' +
      ui("close", 12, 2.2) +
      "</button>" +
      "</div>" +
      '<div class="tl-detail" contenteditable="true" data-tl-field="detail" data-placeholder="Detail \u2014 cause, consequence, figures\u2026">' +
      sanitizeHtmlFragment(it.detail || "") +
      "</div>" +
      "</div></div>";
  });

  html +=
    '<button type="button" class="tl-add" data-tl-add="' + block.id + '">' +
    ui("plus", 12, 2.2) +
    " Add entry</button></div>";
  return html;
}

/*
 * Key term. The one block that is also a flashcard: the term is the question,
 * the meaning is the answer, and the example rides along on the back. Editing
 * the block edits the card, so there is never a copy to keep in step.
 */
export function renderDefinitionBlock(block) {
  return (
    '<div class="b-def" data-fb-block="' + block.id + '">' +
    '<div class="def-main">' +
    '<div class="def-term" contenteditable="true" data-fb-field="term" data-placeholder="Key term">' +
    sanitizeHtmlFragment(block.term || "") +
    "</div>" +
    '<span class="def-chip" title="This block is a flashcard">' +
    ui("cards", 12, 2) +
    "Flashcard</span>" +
    "</div>" +
    '<div class="def-meaning" contenteditable="true" data-fb-field="definition" data-placeholder="What it means, in your own words">' +
    sanitizeHtmlFragment(block.definition || "") +
    "</div>" +
    '<div class="def-example" contenteditable="true" data-fb-field="example" data-placeholder="Example or where it comes up (optional)">' +
    sanitizeHtmlFragment(block.example || "") +
    "</div></div>"
  );
}

/*
 * Comparison. A table forces both sides into one column width; here each side
 * gets its own column that wraps independently, and the pair stays aligned.
 */
export function renderComparisonBlock(block) {
  const rows = Array.isArray(block.rows) ? block.rows : [];
  let html =
    '<div class="b-cmp" data-fb-block="' + block.id + '">' +
    '<div class="cmp-head">' +
    '<div class="cmp-label" contenteditable="true" data-fb-field="leftLabel" data-placeholder="First thing">' +
    sanitizeHtmlFragment(block.leftLabel || "") +
    "</div>" +
    '<div class="cmp-label" contenteditable="true" data-fb-field="rightLabel" data-placeholder="Second thing">' +
    sanitizeHtmlFragment(block.rightLabel || "") +
    "</div></div>";

  rows.forEach((r) => {
    html +=
      '<div class="cmp-row" data-fb-item="' + r.id + '">' +
      '<div class="cmp-cell" contenteditable="true" data-fb-field="left" data-placeholder="Point">' +
      sanitizeHtmlFragment(r.left || "") +
      "</div>" +
      '<div class="cmp-cell" contenteditable="true" data-fb-field="right" data-placeholder="Point">' +
      sanitizeHtmlFragment(r.right || "") +
      "</div>" +
      '<button type="button" class="fb-del" data-fb-del="' + r.id + '" title="Remove this pair">' +
      ui("close", 12, 2.2) +
      "</button></div>";
  });

  return (
    html +
    '<button type="button" class="fb-add" data-fb-add="' + block.id + '">' +
    ui("plus", 12, 2.2) +
    " Add pair</button></div>"
  );
}

/* Process. Numbered stages, each with an optional line on why it matters. */
export function renderProcessBlock(block) {
  const steps = Array.isArray(block.steps) ? block.steps : [];
  let html = '<div class="b-proc" data-fb-block="' + block.id + '">';

  steps.forEach((st, i) => {
    html +=
      '<div class="proc-step" data-fb-item="' + st.id + '">' +
      '<div class="proc-num">' + (i + 1) + "</div>" +
      '<div class="proc-body">' +
      '<div class="proc-text" contenteditable="true" data-fb-field="text" data-placeholder="What you do at this stage">' +
      sanitizeHtmlFragment(st.text || "") +
      "</div>" +
      '<div class="proc-why" contenteditable="true" data-fb-field="why" data-placeholder="Why it matters (optional)">' +
      sanitizeHtmlFragment(st.why || "") +
      "</div></div>" +
      '<button type="button" class="fb-del" data-fb-del="' + st.id + '" title="Remove this step">' +
      ui("close", 12, 2.2) +
      "</button></div>";
  });

  return (
    html +
    '<button type="button" class="fb-add" data-fb-add="' + block.id + '">' +
    ui("plus", 12, 2.2) +
    " Add step</button></div>"
  );
}

/* Source. Quotation, where it came from, and what you make of it. */
export function renderSourceBlock(block) {
  return (
    '<div class="b-src" data-fb-block="' + block.id + '">' +
    '<div class="src-quote" contenteditable="true" data-fb-field="quote" data-placeholder="Quote the source">' +
    sanitizeHtmlFragment(block.quote || "") +
    "</div>" +
    '<div class="src-meta">' +
    '<div class="src-attr" contenteditable="true" data-fb-field="attribution" data-placeholder="Who wrote or said it">' +
    sanitizeHtmlFragment(block.attribution || "") +
    "</div>" +
    '<div class="src-date" contenteditable="true" data-fb-field="date" data-placeholder="When">' +
    sanitizeHtmlFragment(block.date || "") +
    "</div></div>" +
    '<div class="src-comment" contenteditable="true" data-fb-field="comment" data-placeholder="What it shows \u2014 purpose, reliability, how you would use it">' +
    sanitizeHtmlFragment(block.comment || "") +
    "</div></div>"
  );
}

/* Key figure. One number, big, with the context that makes it usable. */
export function renderStatisticBlock(block) {
  return (
    '<div class="b-stat" data-fb-block="' + block.id + '">' +
    '<div class="stat-value" contenteditable="true" data-fb-field="value" data-placeholder="104">' +
    sanitizeHtmlFragment(block.value || "") +
    "</div>" +
    '<div class="stat-side">' +
    '<div class="stat-label" contenteditable="true" data-fb-field="label" data-placeholder="What this number is">' +
    sanitizeHtmlFragment(block.label || "") +
    "</div>" +
    '<div class="stat-context" contenteditable="true" data-fb-field="context" data-placeholder="Source, year, or what it compares with">' +
    sanitizeHtmlFragment(block.context || "") +
    "</div></div></div>"
  );
}

export function renderTableBlock(block) {
  let html = '<table class="b-table"><tbody>';
  block.rows.forEach((row, ri) => {
    html += "<tr>";
    row.forEach((cell, ci) => {
      html +=
        '<td contenteditable="true" data-table-cell="' + block.id + '" data-r="' + ri + '" data-c="' + ci + '">' + sanitizeHtmlFragment(cell) + "</td>";
    });
    html += "</tr>";
  });
  html +=
    "</tbody></table>" +
    '<div class="table-tools">' +
    '<button data-table-add-row="' + block.id + '">' + ui("plus", 12, 2.2) + " Row</button>" +
    '<button data-table-add-col="' + block.id + '">' + ui("plus", 12, 2.2) + " Column</button>" +
    '<button data-table-del-row="' + block.id + '">' + ui("minus", 12, 2.2) + " Row</button>" +
    '<button data-table-del-col="' + block.id + '">' + ui("minus", 12, 2.2) + " Column</button>" +
    "</div>";
  return html;
}

export function renderImageBlock(block) {
  if (!block.src) {
    return (
      '<div class="b-image-empty" data-image-drop="' +
      block.id +
      '"><div class="b-image-empty-icon">' +
      ui("image", 26, 1.6) +
      "</div><div>Click to upload, or paste an image</div>" +
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
