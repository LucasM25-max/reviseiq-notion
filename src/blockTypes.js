// Catalogue of insertable block types (used by the slash menu).
// `aliases` are extra search terms, so /definition finds the key term block.
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
    type: "definition",
    icon: ui("keyTerm", 16),
    title: "Key term",
    desc: "Term and meaning \u2014 becomes a flashcard",
    aliases: "definition flashcard vocabulary glossary term card recall meaning"
  },
  {
    type: "toggle",
    icon: ui("toggle", 16),
    title: "Toggle",
    desc: "Hide detail behind a heading",
    aliases: "collapse fold details accordion hidden"
  },
  { type: "quote", icon: ui("quote", 16), title: "Quote", desc: "Highlighted quote", aliases: "citation" },
  { type: "callout", icon: ui("list", 16), title: "Callout", desc: "Note with an icon", aliases: "note info" },
  { type: "code", icon: ui("code", 16), title: "Code", desc: "Code block", aliases: "snippet" },
  { type: "table", icon: ui("table", 16), title: "Table", desc: "Simple grid table", aliases: "grid" },
  {
    type: "comparison",
    icon: ui("compare", 16),
    title: "Comparison",
    desc: "Two things side by side, point by point",
    aliases: "compare versus contrast columns differences similarities"
  },
  {
    type: "process",
    icon: ui("steps", 16),
    title: "Process",
    desc: "Numbered stages, each with why it matters",
    aliases: "steps method sequence procedure how stages"
  },
  {
    type: "source",
    icon: ui("quote", 16),
    title: "Source",
    desc: "Quotation with attribution and your reading of it",
    aliases: "quotation evidence extract provenance interpretation"
  },
  {
    type: "statistic",
    icon: ui("chart", 16),
    title: "Key figure",
    desc: "One number that matters, with context",
    aliases: "statistic number data figure stat percentage"
  },
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
