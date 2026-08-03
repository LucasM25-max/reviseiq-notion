> **Status: implemented, on Firebase.** This document was the original
> comparison and proposal, and it leaned towards Supabase. The build went
> with **Firebase** instead: Firestore with one document per page (which
> answers the 1 MiB document limit and the "single JSON blob" objection
> raised below), Firebase Auth for Google and email-link sign-in, and Cloud
> Storage for pasted images. See `docs/FIREBASE_SETUP.md` for the setup
> walkthrough and the README for how sync behaves day to day. The phasing,
> conflict policy and local-first principles below all still hold.

# ReviseIQ — Cloud Sync Plan

Status: proposal, not yet implemented.
Written against the current architecture: a static Vercel site, all data in one
`localStorage` key (`reviseiq_state_v1`), no accounts, no backend.

---

## 1. Why this is the next big piece

Right now the workspace lives on exactly one browser profile on one device.
That has three consequences:

1. **No continuity.** Notes written on a laptop are invisible on a phone — which
   is where flashcard review actually happens.
2. **Real data-loss risk.** Clearing site data, resetting a school machine, or
   Safari's 7-day eviction of unused site storage all destroy months of notes.
   The JSON export/import is a mitigation, not a solution: it only works if the
   student remembers to run it.
3. **No recovery from mistakes.** There is no history, so an accidental page
   deletion is permanent.

Sync fixes all three, but only if it is built so the app still works offline
first. The PWA work already landed makes that possible: the client is the source
of truth and the server is a durable mirror.

---

## 2. Design principles

- **Local-first.** `localStorage` stays the primary read/write path. The network
  is never on the critical path for typing. If sync is down, the app is unchanged.
- **One writer per device, last-writer-wins per page.** Full CRDT machinery is
  overkill for a single-user revision app. Page-level granularity is a sensible
  middle ground: two devices editing *different* pages never conflict.
- **Never silently lose text.** Any genuine conflict produces a duplicate page
  ("Topic 1 (conflicted copy, 2 Aug)"), not a discarded edit.
- **Cheap.** Should sit inside free tiers for a personal deployment, and cost
  pennies per user at small scale.
- **Optional.** Signed-out use must keep working exactly as it does today.

---

## 3. Recommended stack

**Supabase** (Postgres + Auth + Row Level Security), called directly from the
browser with the anon key.

Why over the alternatives:

| Option | Verdict |
| --- | --- |
| **Supabase** | Auth, database and RLS in one free tier; magic-link email sign-in suits students with no password manager; direct-from-browser access means no API layer to write. **Recommended.** |
| Vercel KV / Upstash Redis | Trivially simple, but no auth story and no query surface — you would still write an auth layer and serverless routes. |
| Firebase Firestore | Excellent offline SDK, but a heavier client bundle and a data model that fights the existing single-JSON state. |
| Custom Vercel Functions + Neon | Most control, most work; needs its own session handling. Only worth it if the schema outgrows RLS. |

### Schema

```sql
create table workspaces (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references auth.users(id) on delete cascade,
  created_at   timestamptz not null default now()
);

-- One row per page, so devices editing different pages never collide.
create table pages (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  page_id      text not null,             -- the client-side uid()
  data         jsonb not null,            -- the page object, blocks included
  rev          bigint not null,           -- server-incremented revision
  updated_at   timestamptz not null default now(),
  deleted      boolean not null default false,
  primary key (workspace_id, page_id)
);

-- Small, frequently-written singletons kept out of the page rows.
create table workspace_meta (
  workspace_id uuid primary key references workspaces(id) on delete cascade,
  root_page_ids jsonb not null default '[]',
  srs           jsonb not null default '{}',   -- flashcard scheduling
  review_log    jsonb not null default '{}',   -- daily review counts
  rev           bigint not null default 0,
  updated_at    timestamptz not null default now()
);

create index pages_since on pages (workspace_id, rev);
```

RLS: every table restricted to `owner_id = auth.uid()` via the workspace join.
That single policy set is the entire authorisation model.

---

## 4. Sync algorithm

Each device keeps two extra local values: `lastSyncRev` (highest server rev it
has seen) and a `dirty` set of page ids changed since the last successful push.

**Push** (debounced ~3s after the existing 700ms save, and on `visibilitychange`):

1. For each dirty page, `upsert` its row with the base rev the device last saw.
2. The server rejects the write if `rev` has moved on (optimistic concurrency),
   returning the newer row.
3. On rejection, run the merge rules below, then retry once.

**Pull** (on boot, on focus, and every 60s while the tab is visible):

1. `select * from pages where workspace_id = ? and rev > lastSyncRev`.
2. Apply incoming pages that are not locally dirty.
3. Merge the ones that are.
4. Advance `lastSyncRev`, re-render, save locally.

**Merge rules**

- *Different pages changed on each side* → no conflict; take both.
- *Same page, only one side changed* → take that side.
- *Same page changed on both sides* → keep the local version at its own id,
  and insert the remote version as a sibling page titled
  `"<title> (conflicted copy, <date>)"`. Never merge block lists automatically.
- *`srs` / `reviewLog`* → these are additive and safe to merge field-wise:
  for each card take the record with the later `last` date; for the review log
  take the **max** count per day (a day's reviews on two devices are close
  enough, and inflating a streak is a smaller harm than breaking one).
- *Deletions* → tombstone rows (`deleted = true`) rather than row removal, so a
  stale device cannot resurrect a deleted page. Purge tombstones after 90 days.

**Realtime** is a later nicety: subscribing to Postgres changes turns the 60s
poll into instant propagation, but polling is enough for one person with two
devices and costs far less complexity.

---

## 5. Auth and onboarding

- Magic-link email sign-in (no passwords to forget, works on school email).
- The app stays fully usable signed out. Signing in for the first time offers:
  *"Upload this device's workspace"* or *"Replace it with your cloud workspace"* —
  with a mandatory local JSON backup taken automatically before either.
- Sign-out clears the cached session but leaves `localStorage` intact.
- Account deletion cascades from `auth.users`, so one row delete removes
  everything.

---

## 6. Client changes required

| File | Change |
| --- | --- |
| `src/storage.js` | After each `doSave()`, mark touched page ids dirty and schedule a push. |
| `src/sync.js` *(new)* | Client, push/pull loops, merge rules, rev bookkeeping. |
| `src/auth.js` *(new)* | Supabase session handling, magic-link flow, sign-out. |
| `src/model.js` | Add `syncMeta: { workspaceId, lastSyncRev, dirty }` to state, and to `normalizeState`. |
| `src/render/sidebar.js` | Extend the existing save-status dot: *Saved locally* → *Synced 2m ago* → *Offline, will sync*. |
| `src/backup.js` | Unchanged, and deliberately kept — an offline escape hatch matters more once there is a cloud copy, not less. |
| `sw.js` | Exclude Supabase API calls from the cache (they are cross-origin, so already excluded — verify). |

New dependency: `@supabase/supabase-js` (~30 KB gzipped), loaded lazily and only
when a session exists, so signed-out users pay nothing.

---

## 7. Phasing

**Phase 1 — Durable backup (½ day).** Sign-in plus a manual
*"Back up to cloud" / "Restore from cloud"* pair that pushes and pulls the whole
state blob. No merge logic. This alone removes the data-loss risk, which is the
single biggest problem, and it is genuinely a few hours of work.

**Phase 2 — Automatic one-way sync (1–2 days).** Push on save, pull on boot.
Safe when devices are used one at a time — which is the common case: laptop in
the evening, phone on the bus.

**Phase 3 — Per-page bidirectional sync (2–3 days).** The revision/merge scheme
above, conflicted copies, tombstones, and the status indicator.

**Phase 4 — Nice-to-haves.** Realtime subscriptions, page version history
(cheap once every write has a rev — keep the last N revisions per page and add a
"restore this version" UI), and shared read-only subject links for revising with
friends.

---

## 8. Risks and how to handle them

- **Row size.** Pasted images are stored as base64 data URLs today. A page with
  several photos can approach Postgres row limits and makes sync slow. Before
  Phase 2, move images to Supabase Storage and keep a URL in the block. This is
  a prerequisite, not an afterthought.
- **Storage quota abuse.** Cap per-workspace bytes and surface the existing
  size warning against the server total rather than `localStorage`.
- **Clock skew.** Never merge on client timestamps; the server `rev` is the only
  ordering authority. Client dates are display-only.
- **Silent sync failure.** If a push fails three times, stop retrying and say so
  in the status area. A sync indicator that lies is worse than none.
- **Scope creep into multi-user.** Sharing and collaboration need a different
  model (per-block CRDTs, presence). Keep this plan strictly single-user; revisit
  only if that becomes a real requirement.

---

## 9. Estimate

Phases 1–3 land in roughly a week of focused work, with Phase 1 usable on day
one. The image-to-storage migration is the only piece with meaningful hidden
cost, so it should be scheduled first.
