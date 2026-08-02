// Catalogue of insertable block types (used by the slash menu).
export const BLOCK_TYPES = [
  { type: "paragraph", icon: "T", title: "Text", desc: "Plain text" },
  { type: "heading1", icon: "H1", title: "Heading 1", desc: "Big section heading" },
  { type: "heading2", icon: "H2", title: "Heading 2", desc: "Medium heading" },
  { type: "heading3", icon: "H3", title: "Heading 3", desc: "Small heading" },
  { type: "bulleted", icon: "\u2022", title: "Bulleted list", desc: "A simple bullet point" },
  { type: "numbered", icon: "1.", title: "Numbered list", desc: "A numbered item" },
  { type: "todo", icon: "\u2611", title: "To-do", desc: "Checklist item" },
  { type: "toggle", icon: "\u25B8", title: "Toggle list", desc: "Collapsible content" },
  { type: "quote", icon: "\u275D", title: "Quote", desc: "Highlighted quote" },
  { type: "callout", icon: "\uD83D\uDCA1", title: "Callout", desc: "Note with an icon" },
  { type: "code", icon: "&lt;/&gt;", title: "Code", desc: "Code block" },
  { type: "table", icon: "\u2637", title: "Table", desc: "Simple grid table" },
  { type: "divider", icon: "\u2015", title: "Divider", desc: "Horizontal line" },
  { type: "image", icon: "\uD83D\uDDBC", title: "Image", desc: "Upload or paste" },
  { type: "video", icon: "\u25B6", title: "Video", desc: "Embed a YouTube link" },
  { type: "page", icon: "\uD83D\uDCC4", title: "Sub-page", desc: "Create a nested page" }
];
