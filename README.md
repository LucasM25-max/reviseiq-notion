# ReviseIQ

A calm, Notion-style revision workspace: subjects, nested pages, a block editor,
exam boards, exam-date countdowns and an exam calendar. Everything is saved
locally in the browser, so there is no backend, database or login to configure.

This is the multi-file version of the original single-file prototype, split into
plain ES modules and separate stylesheets. There is **no build step** — the
folder is deployable to Vercel exactly as it is.

## Project structure

```
.
├─ index.html              # App shell (sidebar + main panel + overlay root)
├─ favicon.svg
├─ vercel.json             # Static config: clean URLs, cache + security headers
├─ package.json            # Metadata + a local dev server script
├─ styles/
│  ├─ base.css             # Design tokens, reset, layout, responsive rules
│  ├─ sidebar.css          # Brand, next-exam card, page tree, save status
│  ├─ main.css             # Breadcrumbs, page header, exam panel, calendar view
│  ├─ blocks.css           # Every block type
│  └─ overlays.css         # Toolbar, menus, popovers, modal
└─ src/
   ├─ main.js              # Entry point: load state, wire events, first render
   ├─ utils.js             # ids, escaping/sanitising, dates, image compression
   ├─ model.js             # Block + page factories, default & normalised state
   ├─ state.js             # The store and read-only queries over it
   ├─ storage.js           # localStorage autosave, save status, quota banner
   ├─ exams.js             # Next exam + upcoming/past exam lists
   ├─ pages.js             # Page operations and navigation
   ├─ blocks.js            # Block operations (insert, convert, move, delete)
   ├─ blockTypes.js        # Slash-menu catalogue
   ├─ focus.js             # Caret/selection helpers for contenteditable
   ├─ overlays.js          # Floating toolbar, slash menu, pickers, modal
   ├─ render/
   │  ├─ sidebar.js        # Sidebar + next-exam card
   │  ├─ main.js           # Page view (breadcrumbs, header, exam panel, blocks)
   │  ├─ blocks.js         # Block HTML
   │  └─ calendar.js       # Exam calendar view
   └─ events/
      ├─ mainEvents.js     # Editor interactions, paste, images, drag reorder
      └─ sidebarEvents.js  # Tree navigation, new pages, calendar button
```

## Changes from the single-file prototype

- **Storage now uses `localStorage`.** The original relied on a host-provided
  `window.storage` API that does not exist on the open web. Notes autosave to
  the browser under the key `reviseiq_state_v1`, with the same debounce, save
  indicator and “storage nearly full” banner. Quota errors are handled.
- **The exam calendar is implemented.** The prototype had the button, the state
  and the styles, but no calendar renderer. Clicking **Exam calendar** now shows
  a hero countdown to the next exam plus sorted upcoming and past lists; each
  row jumps to its subject page.
- Clicking the **Next exam** card in the sidebar also jumps to that subject.
- Small polish: responsive layout for narrow screens, favicon, page metadata,
  and a generic welcome heading instead of a hard-coded name.

All editor behaviour — slash menu, 16 block types, rich-text toolbar, links,
toggles, tables, code blocks, image upload/paste/compression, YouTube embeds,
drag-to-reorder, nested sub-pages, delete confirmation — is unchanged.

## Run it locally

Because the app uses ES modules, open it through a server rather than
double-clicking `index.html`:

```bash
npm run dev          # then visit http://localhost:3000
# or
npx serve .
```

## Deploy to Vercel

The project is a static site with no build step. Any of these work:

**1. Vercel CLI**

```bash
npm i -g vercel
vercel          # preview deployment
vercel --prod   # production
```

**2. Git import (recommended)**

1. Push this folder to a GitHub/GitLab/Bitbucket repository.
2. In Vercel, choose **Add New → Project** and import the repo.
3. Framework Preset: **Other**. Leave Build Command empty and set Output
   Directory to the repository root (Vercel detects this automatically).
4. Deploy.

**3. Drag and drop**

Drop the project folder onto the Vercel dashboard’s new-project area.

## Data notes

- Notes live in the visitor’s browser only — they are not synced between
  devices or browsers, and clearing site data erases them.
- Images are resized to a max of 1000px and stored as compressed JPEG data URLs
  to stay within the browser storage budget.
- To back up, run `localStorage.getItem("reviseiq_state_v1")` in the console and
  save the JSON.
