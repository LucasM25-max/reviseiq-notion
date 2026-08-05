// Catalogue of insertable block types (used by the slash menu).
// `aliases` are extra search terms so /toggle still finds the flashcard block.
import { ui } from "./icons.js";

export const BLOCK_TYPES = [
  { type: "paragraph", icon: ui("text", 16), title: "Text", desc: "Plain text", aliases: "paragraph body" },
  { type: "heading1", icon: ui("heading1", 16), title: "Heading 1", desc: "Big section heading", aliases: "h1 title" },
  { type: "heading2", icon: ui("heading2", 16), title: "Heading 2", desc: "Medium heading", aliases: "h2" },
  { type: "heading3", icon: ui("heading3", 16), title: "Heading 3", desc: "Small heading", aliases: "h3" },
  { type: "bulleted", icon: ui("bullet", 16), title: "Bulleted list", desc: "A simple bullet point", aliases: "list" },
  { type: "numbered", icon: ui("numbered", 16), title: "Numbered list", desc: "A numbered item", aliases: "ordered list" },
  { type: "todo", icon: ui("todo", 16), title: "To-do", desc: "Checklist item", aliases: "task checkbox" },
  {
    type: "toggle",
    icon: ui("flashcard", 16),
    title: "Flashcard",
    desc: "Question now, answer hidden \u2014 used in Revise",
    aliases: "toggle card quiz recall question answer revise"
  },
  { type: "quote", icon: ui("quote", 16), title: "Quote", desc: "Highlighted quote", aliases: "citation" },
  { type: "callout", icon: ui("list", 16), title: "Callout", desc: "Note with an icon", aliases: "note info" },
  { type: "code", icon: ui("code", 16), title: "Code", desc: "Code block", aliases: "snippet" },
  { type: "table", icon: ui("table", 16), title: "Table", desc: "Simple grid table", aliases: "grid" },
  {
    type: "timeline",
    icon: ui("timeline", 16),
    title: "Timeline",
    desc: "Dated events down a rail, with detail",
    aliases: "chronology dates sequence order events history"
  },
  { type: "divider", icon: ui("divider", 16), title: "Divider", desc: "Horizontal line", aliases: "line separator" },
  { type: "image", icon: ui("image", 16), title: "Image", desc: "Upload or paste", aliases: "picture photo" },
  { type: "video", icon: ui("play", 16), title: "Video", desc: "Embed a YouTube link", aliases: "youtube embed" },
  { type: "page", icon: ui("page", 16), title: "Sub-page", desc: "Create a nested page", aliases: "subpage child" }
];

export function matchBlockTypes(query) {
  const q = String(query || "").toLowerCase().trim();
  if (!q) return BLOCK_TYPES;
  return BLOCK_TYPES.filter(
    (bt) => bt.title.toLowerCase().indexOf(q) > -1 || (bt.aliases || "").indexOf(q) > -1
  );
}
