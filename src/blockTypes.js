// Catalogue of insertable block types (used by the slash menu).
import { ui } from "./icons.js";

export const BLOCK_TYPES = [
  { type: "paragraph", icon: ui("text", 16), title: "Text", desc: "Plain text" },
  { type: "heading1", icon: ui("heading1", 16), title: "Heading 1", desc: "Big section heading" },
  { type: "heading2", icon: ui("heading2", 16), title: "Heading 2", desc: "Medium heading" },
  { type: "heading3", icon: ui("heading3", 16), title: "Heading 3", desc: "Small heading" },
  { type: "bulleted", icon: ui("bullet", 16), title: "Bulleted list", desc: "A simple bullet point" },
  { type: "numbered", icon: ui("numbered", 16), title: "Numbered list", desc: "A numbered item" },
  { type: "todo", icon: ui("todo", 16), title: "To-do", desc: "Checklist item" },
  { type: "toggle", icon: ui("toggle", 16), title: "Toggle list", desc: "Collapsible content" },
  { type: "quote", icon: ui("quote", 16), title: "Quote", desc: "Highlighted quote" },
  { type: "callout", icon: ui("list", 16), title: "Callout", desc: "Note with an icon" },
  { type: "code", icon: ui("code", 16), title: "Code", desc: "Code block" },
  { type: "table", icon: ui("table", 16), title: "Table", desc: "Simple grid table" },
  { type: "divider", icon: ui("divider", 16), title: "Divider", desc: "Horizontal line" },
  { type: "image", icon: ui("image", 16), title: "Image", desc: "Upload or paste" },
  { type: "video", icon: ui("play", 16), title: "Video", desc: "Embed a YouTube link" },
  { type: "page", icon: ui("page", 16), title: "Sub-page", desc: "Create a nested page" }
];
