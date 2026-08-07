# ReviseIQ

ReviseIQ is a calm, Notion-style revision workspace for students. It combines structured notes, exam planning, active recall, written practice, mock exams, flashcards and optional cloud sync in one browser app.

The app is **local-first**: the core workspace works without an account or backend. Firebase adds optional accounts/sync, while Gemini powers the AI revision workflows when configured.

## What it does

### Notes and pages

- Create subjects and nested pages.
- Keep subpages inline inside parent pages while also navigating them from the sidebar.
- Use a block editor with paragraphs, headings, bullet/numbered lists, to-dos, quotes, callouts, code, dividers, tables, timelines, key-term/definition blocks, comparisons, processes, sources, statistics, toggles, images, YouTube videos and page links.
- Convert, move, duplicate, delete and drag-reorder blocks.
- Use a slash menu and floating rich-text toolbar.
- Paste/upload images; images are compressed for local storage.
- Use a table of contents and global note search.

### Subjects and exams

Subjects can have an exam board and multiple exam dates. The sidebar can surface the next exam, and the **Exam calendar** provides upcoming and past exam lists with navigation back to subject pages.

Exam-specific functionality is deliberately conservative: ReviseIQ only uses an exam structure where it has explicit data rather than inventing an exam format. The most developed implementation is currently **AQA GCSE History**.

### Plan

The **Plan** view builds a revision schedule from your available study time, exam dates, notes, revision state and task history.

It supports:

- same study time every day, weekday/weekend splits, or custom time for each day;
- maximum subjects per day;
- automatic scheduling of eligible mock tests;
- a narrower planning mode for covering less material with fewer passes;
- due flashcard work alongside scheduled tasks;
- missed-work carry-over;
- manually pulling future work into today;
- completing and skipping tasks;
- measuring actual task time and calibrating estimates to your pace;
- plan-health/slippage information;
- a weekly digest.

Completed/skipped history is preserved while future scheduling can be regenerated around changed settings.

### Flashcards

Flashcards have their own library instead of cluttering notes.

Cards come from either:

1. completed **Key term**/definition blocks in notes; or
2. mistakes made in Quiz, Practise or Test sessions.

Cards have spaced-repetition scheduling and review history. Older toggle-based cards are migrated into the dedicated library while retaining their old IDs where possible.

### Quiz me

**Quiz me** generates a hard multiple-choice quiz from your notes using Gemini.

You can choose the current page or its subpages, and choose an automatic or fixed question count. Unfinished quizzes can be resumed. The quiz is a focused full-screen experience, is not timed, and supports keyboard navigation.

Generated questions include their answer key, so marking is immediate in the browser. Results include explanations, can request an AI weak-area review, and can turn missed questions into flashcards. Quiz insights feed back into the wider revision system.

The API validates generated questions, limits input/output, rejects unusable generations and applies shared generation capacity plus optional per-user quotas.

### Practise

**Practise** is the middle step between multiple-choice recall and a full mock exam.

It creates a short written session, normally around 10–25 minutes, using open-ended questions answered in the student's own words. Where ReviseIQ has a recognised exam structure, it can continue into real exam-style questions from its registered question set. The setup screen previews the expected shape, marks and approximate time.

If the exam structure is unknown, ReviseIQ does **not** fabricate exam questions; the session remains a written knowledge exercise.

Practise attempts can be resumed, marked, converted into insights and used to create flashcards from mistakes.

### Test me

**Test me** is the full mock-exam workflow. The current exam-specific implementation is for supported AQA GCSE History structures.

A supported test can select the appropriate component, generate a timed paper from the student's notes, collect typed answers, mark them against the registered level descriptors/mark scheme, account for SPaG where applicable, report examiner-style feedback, record focus areas/missed points, create flashcards from mistakes and feed completion back into Plan.

The result is **AI-assisted marking against ReviseIQ's registered marking model**, not an official awarding-body mark.

### Backup and restore

The sidebar provides **Export** and **Import** for complete JSON workspace backups. This is especially important in local-only mode because clearing browser/site data removes local data.

## Local-first architecture

Without Firebase, ReviseIQ needs no login, database or backend for normal editing. Workspace state lives in browser `localStorage` and includes pages, blocks, flashcards, spaced-repetition state, review history, quiz attempts, practise attempts, mock attempts, insights and Plan state.

Autosave is debounced, with additional lifecycle/network saves and storage-quota handling. Local storage is always the first write path; editing does not wait for the network.

There is no automatic cross-device sync in local-only mode.

## Optional Firebase sync

Firebase is layered on top of local storage. When configured, ReviseIQ supports:

- Google sign-in;
- passwordless email-link sign-in;
- Firestore synchronisation;
- Cloud Storage image offloading;
- offline queuing;
- per-page sync documents;
- conflict preservation via conflicted copies;
- first-sign-in merge/device/account choices;
- an automatic JSON backup before that first replacement/merge;
- synced/syncing/offline/paused status;
- long-polling fallback for networks that interfere with Firestore streaming.

With no Firebase configuration, the cloud UI remains inactive and the app behaves exactly as a local-first application.

See [`docs/FIREBASE_SETUP.md`](docs/FIREBASE_SETUP.md) for setup, security rules, named Firestore databases, image CORS, diagnostics and troubleshooting.

## AI architecture

Gemini is called server-side. `GEMINI_API_KEY` never reaches the browser.

Current Vercel endpoints include:

- `GET /api/config` — serves optional Firebase web configuration.
- `POST /api/quiz/generate` — generates multiple-choice quizzes.
- `POST /api/quiz/review` — reviews quiz results/weak areas.
- `POST /api/test/generate` — generates supported mock-exam material.
- `POST /api/test/mark` — marks supported mock-exam attempts.

AI endpoints have request validation, input limits, output normalisation and shared concurrency protection. When Firebase identity is available, usage can also be tracked against per-user quotas. `REQUIRE_AUTH=1` makes AI requests require a valid signed-in Firebase user.

## PWA, mobile and accessibility-related UX

ReviseIQ includes progressive-web-app support, install metadata/icons, service-worker registration, launch shortcuts, responsive/mobile navigation, connectivity notices and print-specific styling.

On small screens the sidebar becomes a navigation drawer and the mobile bar exposes Plan, Search and Flashcards without requiring the desktop layout.

## Project structure

The frontend is plain HTML/CSS/JavaScript using native ES modules. There is no frontend build step.

```text
.
├─ index.html
├─ package.json
├─ vercel.json
├─ firestore.rules
├─ storage.rules
├─ manifest.webmanifest
├─ sw.js
├─ docs/FIREBASE_SETUP.md
├─ api/
│  ├─ config.js
│  ├─ _lib/auth.js
│  ├─ _lib/usage.js
│  ├─ quiz/generate.js
│  ├─ quiz/review.js
│  ├─ test/generate.js
│  └─ test/mark.js
├─ styles/
│  ├─ base.css
│  ├─ sidebar.css
│  ├─ main.css
│  ├─ blocks.css
│  ├─ overlays.css
│  ├─ icons.css
│  ├─ toc.css
│  ├─ search.css
│  ├─ onboarding.css
│  ├─ revise.css
│  ├─ today.css
│  ├─ plan.css
│  ├─ exam.css
│  ├─ quiz.css
│  ├─ practise.css
│  ├─ cloud.css
│  ├─ mobile.css
│  └─ print.css
└─ src/
   ├─ main.js
   ├─ model.js
   ├─ state.js
   ├─ storage.js
   ├─ utils.js
   ├─ icons.js
   ├─ pages.js
   ├─ blocks.js
   ├─ blockTypes.js
   ├─ focus.js
   ├─ overlays.js
   ├─ cards.js
   ├─ srs.js
   ├─ exams.js
   ├─ onboarding.js
   ├─ pwa.js
   ├─ render/{sidebar,main,blocks,calendar,flashcards,search}.js
   ├─ events/{mainEvents,sidebarEvents,mobileEvents}.js
   ├─ exam/{session,notes,aqaHistory}.js
   ├─ quiz/{session,store,quizPrompt,flashcards}.js
   ├─ practise/{session,store,prompt}.js
   ├─ plan/{engine,store}.js
   └─ cloud/{index,auth}.js
```

The code is intentionally split by responsibility rather than by framework conventions: state/model, persistence, pages/blocks, rendering/events, revision engines, AI sessions and cloud sync are separate concerns.

## Run locally

Because the app uses native ES modules, serve it over HTTP instead of opening `index.html` directly.

```bash
npm run dev
```

Then open `http://localhost:3000`.

The `start` script runs the same Python HTTP server. The frontend has no npm dependency installation/build step.

## Deploy to Vercel

ReviseIQ is a static site plus Vercel serverless functions.

### Git import

1. Import the repository into Vercel.
2. Use **Other** as the framework preset if requested.
3. Leave the build command empty.
4. Use the repository root as the output directory.
5. Deploy.

### CLI

```bash
npm i -g vercel
vercel
vercel --prod
```

`vercel.json` sets clean URLs, cache/security headers and explicit function durations for the API routes.

## Environment variables

### AI

| Variable | Purpose |
| --- | --- |
| `GEMINI_API_KEY` | Server-side Gemini access for Quiz/Test/AI review workflows. |

### Firebase sync

| Variable | Purpose |
| --- | --- |
| `FIREBASE_API_KEY` | Firebase web configuration. |
| `FIREBASE_AUTH_DOMAIN` | Firebase Authentication web configuration. |
| `FIREBASE_PROJECT_ID` | Firebase project ID and backend token verification. |
| `FIREBASE_STORAGE_BUCKET` | Cloud Storage bucket for images. |
| `FIREBASE_MESSAGING_SENDER_ID` | Firebase web configuration. |
| `FIREBASE_APP_ID` | Firebase web configuration. |

### Optional

| Variable | Purpose |
| --- | --- |
| `FIREBASE_DATABASE_ID` | Firestore database name when it is not `(default)`. |
| `REQUIRE_AUTH` | Set to `1` to require Firebase authentication for AI endpoints. |

Firebase web-config values identify the project and are designed to be public; security comes from Firebase Authentication and the repository's Firestore/Storage rules. `GEMINI_API_KEY` is a secret and must remain server-side.

## Data and privacy model

**Local-only:** ordinary editing can remain entirely in the browser.

**Cloud/AI-enabled:** the relevant material is sent to the configured service when a feature requires it. Gemini receives the notes/context needed for AI generation or marking; Firebase receives synchronised workspace data when sync is enabled.

Images start as compressed inline data locally. With cloud sync enabled, they can be moved to Cloud Storage in the background.

Do not put passwords, API keys or other secrets into revision notes.

## Migration and compatibility

The data model contains migration/normalisation logic for older saves. This includes converting legacy emoji icons, repairing missing block fields, restoring missing inline subpage links and migrating older toggle-based flashcards into the dedicated card library while retaining IDs where possible.

## Design philosophy

ReviseIQ is designed as one connected revision loop rather than a collection of unrelated tools:

```text
Organise knowledge
      ↓
Plan revision
      ↓
Recall it
      ↓
Write it under pressure
      ↓
Test it in an exam-shaped task
      ↓
Learn from mistakes
      ↓
Turn mistakes into future revision
```

Plan, Flashcards, Quiz, Practise and Test therefore feed information back into one another. A session can change what gets revised next instead of ending at a score.

## Current scope and limitations

ReviseIQ is a student revision workspace, not an official exam-board platform. Exam-specific functionality is intentionally limited to structures explicitly represented in the application. The most developed implementation is AQA GCSE History.

AI-generated questions and AI-assisted marking should be treated as study assistance rather than authoritative exam-board material. For high-stakes revision decisions, compare against the relevant official specification and mark scheme.

## Firebase setup

For the full cloud setup and troubleshooting guide, see [`docs/FIREBASE_SETUP.md`](docs/FIREBASE_SETUP.md).
