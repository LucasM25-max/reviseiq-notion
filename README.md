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

## Mock exams (Test me)

AQA GCSE History (8145) pages get a **Test me** button. It generates a full one-hour section paper from your notes, times it, marks it against AQA-style level descriptors (including SPaG where the real paper awards it), and files the examiner's focus areas and missed points into your feedback list.

The two serverless routes (`api/test/generate.js`, `api/test/mark.js`) call Gemini, so the deployment needs one environment variable:

| Name | Value |
| --- | --- |
| `GEMINI_API_KEY` | Your Google AI Studio API key |

In Vercel: **Settings -> Environment Variables -> Add** (Production, Preview and Development), then redeploy. The model used is `gemini-flash-latest`.

## Quizzes (Quiz me)

Every page with more than about eighty words of notes gets a **Quiz me** button. Gemini writes a hard multiple-choice quiz (ten to twenty questions, or a length you pick) covering that page, or that page and its subpages if you ask for it. There is no timer.

Marking happens in the browser, because the answer key comes back with the questions, so results are instant. Anything you get wrong is filed into the same **Exam feedback** list the mock exams use, and one button turns every wrong answer into a flashcard at the bottom of the page, which then enters the normal revision schedule.

The quiz routes (`api/quiz/generate.js`, `api/quiz/review.js`) use the same `GEMINI_API_KEY` and the same `gemini-flash-latest` model as the mock exams. No extra configuration is needed.

## Cloud sync and accounts

Sync is optional and layered on top of the existing local storage, never in place of it. With no Firebase configured the app behaves exactly as it always has: everything lives in `localStorage` on the device, and the sidebar shows no account row.

Once Firebase is configured (see `docs/FIREBASE_SETUP.md` for the ten-minute walkthrough), a **Sign in to sync** row appears at the foot of the sidebar. Signing in with Google or an emailed sign-in link mirrors the workspace to Firestore.

How it behaves:

- **Local first.** Every change is written to `localStorage` first, on a 700 ms debounce, with a 10 second heartbeat and an immediate write whenever the tab is hidden, closed or comes back online. The network is never on the path between typing and saving.
- **One document per page.** Two devices editing different pages never collide. Flashcard schedules, feedback, quizzes and mock exams sync as their own documents.
- **Conflicts keep both copies.** If the same page changed in two places since the last sync, the newer version wins and the older one is preserved as "Page name (conflicted copy, 3 Aug)". Nothing typed is discarded.
- **Offline.** Firestore keeps its own offline mirror, so edits made on a train are queued and pushed on reconnect. The status line under your name reports `Synced`, `Syncing`, `Offline` or `Sync paused`.
- **Images.** Pasted images are compressed and stored inline while signed out. Once signed in they move to Cloud Storage in the background, which keeps page documents well inside Firestore's 1 MiB limit.
- **First sign-in on a device that already has notes** asks once whether to merge, keep the device, or keep the account, and downloads a JSON backup before anything is replaced.

### Environment variables

| Name | Required | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | for AI features | Quiz and mock exam generation and marking |
| `FIREBASE_API_KEY` | for sync | Firebase web config |
| `FIREBASE_AUTH_DOMAIN` | for sync | Firebase web config |
| `FIREBASE_PROJECT_ID` | for sync | Firebase web config, and token verification on the API |
| `FIREBASE_STORAGE_BUCKET` | for sync | Image uploads |
| `FIREBASE_MESSAGING_SENDER_ID` | for sync | Firebase web config |
| `FIREBASE_APP_ID` | for sync | Firebase web config |
| `REQUIRE_AUTH` | optional | Set to `1` to reject unauthenticated calls to the Gemini endpoints |

The six Firebase values are public by design; access is controlled by `firestore.rules` and `storage.rules`, both included in this repo.
