/*
 * Local-first sync between localStorage and Firestore.
 *
 * Rules of the road:
 *   - localStorage is always written first and is always complete. If sync is
 *     off, broken, or offline, the app behaves exactly as it did before.
 *   - Firestore holds one document per page, so two devices editing different
 *     pages never collide.
 *   - Change detection is by content hash, so no call site has to remember to
 *     mark anything dirty.
 *   - A genuine conflict (both sides edited the same page since the last sync)
 *     keeps the newer copy and preserves the older one as a duplicate page.
 *     Nothing a student typed is ever silently dropped.
 */
import { store, setState } from "../state.js";
import { normalizeState } from "../model.js";
import { doSave, setSaveStatus } from "../storage.js";
import { uid as newId } from "../utils.js";
import { getFirebase } from "./firebase.js";
import { runImageMigration } from "./images.js";

const DEVICE_KEY = "reviseiq_device_id";
const BASE_KEY_PREFIX = "reviseiq_sync_base_v1:";
const FLUSH_DEBOUNCE_MS = 1500;
const FLUSH_INTERVAL_MS = 15000;
const BATCH_LIMIT = 400;

/* Meta documents: small singletons kept out of the page documents. */
const META_KEYS = ["workspace", "srs", "insights"];

let ctx = null; // { uid, fb, base, revs, unsubs, applying }
let flushTimer = null;
let intervalTimer = null;
let listeners = [];
let lastStatus = { state: "off", text: "Local only" };
let pendingMergeResolve = null;
let rerender = null;

/* ------------------------------------------------------------------ *
 * status plumbing
 * ------------------------------------------------------------------ */

export function onSyncStatus(fn) {
  listeners.push(fn);
  try {
    fn(lastStatus);
  } catch (e) {
    /* ignore */
  }
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}

function status(state, text) {
  lastStatus = { state, text, at: Date.now() };
  listeners.slice().forEach((fn) => {
    try {
      fn(lastStatus);
    } catch (e) {
      /* ignore */
    }
  });
}

export function syncStatusNow() {
  return lastStatus;
}

/** The app tells us how to repaint after remote changes land. */
export function setSyncRerender(fn) {
  rerender = fn;
}

function repaint() {
  if (typeof rerender === "function") {
    try {
      rerender();
    } catch (e) {
      console.warn("[sync] repaint failed", e);
    }
  }
}

/* ------------------------------------------------------------------ *
 * small helpers
 * ------------------------------------------------------------------ */

function deviceId() {
  let id = null;
  try {
    id = window.localStorage.getItem(DEVICE_KEY);
  } catch (e) {
    id = null;
  }
  if (!id) {
    id = newId();
    try {
      window.localStorage.setItem(DEVICE_KEY, id);
    } catch (e) {
      /* ignore */
    }
  }
  return id;
}

/* FNV-1a: short, stable, and cheap enough to run over every page on save. */
function hashOf(value) {
  const str = typeof value === "string" ? value : JSON.stringify(value);
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16) + ":" + str.length;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadBase(uid) {
  try {
    const raw = window.localStorage.getItem(BASE_KEY_PREFIX + uid);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object") {
      return {
        pages: parsed.pages || {},
        meta: parsed.meta || {},
        quizzes: parsed.quizzes || {},
        tests: parsed.tests || {},
        synced: Boolean(parsed.synced)
      };
    }
  } catch (e) {
    /* fall through */
  }
  return { pages: {}, meta: {}, quizzes: {}, tests: {}, synced: false };
}

function saveBase() {
  if (!ctx) return;
  try {
    window.localStorage.setItem(BASE_KEY_PREFIX + ctx.uid, JSON.stringify(ctx.base));
  } catch (e) {
    /* the base map is only an optimisation; losing it costs one extra merge */
  }
}

/* ------------------------------------------------------------------ *
 * shaping local state into documents
 * ------------------------------------------------------------------ */

function metaPayload(key) {
  const s = store.state;
  if (key === "workspace") {
    return {
      rootPageIds: s.rootPageIds || [],
      expanded: s.expanded || {},
      activePageId: s.activePageId || null
    };
  }
  if (key === "srs") return { srs: s.srs || {}, reviewLog: s.reviewLog || {} };
  if (key === "insights") return { insights: s.insights || [] };
  return {};
}

function applyMetaPayload(key, data) {
  if (!data || typeof data !== "object") return;
  const s = store.state;
  if (key === "workspace") {
    if (Array.isArray(data.rootPageIds)) s.rootPageIds = data.rootPageIds;
    if (data.expanded && typeof data.expanded === "object") s.expanded = data.expanded;
    // activePageId is per-device; deliberately not applied from the cloud.
  } else if (key === "srs") {
    if (data.srs && typeof data.srs === "object") s.srs = data.srs;
    if (data.reviewLog && typeof data.reviewLog === "object") s.reviewLog = data.reviewLog;
  } else if (key === "insights") {
    if (Array.isArray(data.insights)) s.insights = data.insights;
  }
}

function collectionMap(kind) {
  if (kind === "quizzes") return store.state.quizzes || {};
  if (kind === "tests") return store.state.tests || {};
  return {};
}

/* ------------------------------------------------------------------ *
 * lifecycle
 * ------------------------------------------------------------------ */

/**
 * Begins syncing for a signed-in user.
 * Resolves with { ok } or { ok:false, needsChoice:true } when a first-run
 * merge decision is required from the student.
 */
export async function startSync(user) {
  await stopSync();
  if (!user || !user.uid) return { ok: false };

  const fb = await getFirebase();
  if (!fb.ok) {
    status("error", "Sync unavailable");
    return { ok: false };
  }

  ctx = {
    uid: user.uid,
    fb,
    base: loadBase(user.uid),
    revs: {},
    unsubs: [],
    applying: false,
    device: deviceId()
  };

  status("syncing", "Connecting\u2026");

  try {
    await fb.sdk.setDoc(
      fb.sdk.doc(fb.db, "users", ctx.uid),
      {
        email: user.email || "",
        displayName: user.displayName || "",
        schemaVersion: 1,
        lastSeenAt: fb.sdk.serverTimestamp()
      },
      { merge: true }
    );
  } catch (e) {
    console.warn("[sync] profile write failed", e);
  }

  // First run on this device: work out whether we push, pull, or ask.
  if (!ctx.base.synced) {
    let remote;
    try {
      remote = await fetchEverything();
    } catch (e) {
      console.warn("[sync] initial read failed", e);
      status("error", "Couldn't reach the cloud");
      return { ok: false };
    }
    const remoteCount = Object.keys(remote.pages).length;
    const localCount = Object.keys(store.state.pages || {}).length;

    if (remoteCount === 0) {
      await pushEverything();
    } else if (localCount === 0) {
      applyRemoteSnapshot(remote, "replace");
    } else {
      status("idle", "Choose what to keep");
      return { ok: false, needsChoice: true, localCount, remoteCount, remote };
    }
  }

  subscribe();
  startTimers();
  status("idle", "Synced");
  scheduleFlush();
  return { ok: true };
}

export async function stopSync() {
  stopTimers();
  if (ctx) {
    ctx.unsubs.forEach((fn) => {
      try {
        fn();
      } catch (e) {
        /* ignore */
      }
    });
  }
  ctx = null;
  pendingMergeResolve = null;
  status("off", "Local only");
}

export function isSyncing() {
  return Boolean(ctx);
}

function startTimers() {
  stopTimers();
  intervalTimer = setInterval(() => flushNow("interval"), FLUSH_INTERVAL_MS);
}

function stopTimers() {
  if (flushTimer) clearTimeout(flushTimer);
  if (intervalTimer) clearInterval(intervalTimer);
  flushTimer = null;
  intervalTimer = null;
}

/* ------------------------------------------------------------------ *
 * first-run merge
 * ------------------------------------------------------------------ */

async function fetchEverything() {
  const fb = ctx.fb;
  const out = { pages: {}, meta: {}, quizzes: {}, tests: {} };

  const pageSnap = await fb.sdk.getDocs(fb.sdk.collection(fb.db, "users", ctx.uid, "pages"));
  pageSnap.forEach((d) => {
    out.pages[d.id] = d.data();
  });
  const metaSnap = await fb.sdk.getDocs(fb.sdk.collection(fb.db, "users", ctx.uid, "meta"));
  metaSnap.forEach((d) => {
    out.meta[d.id] = d.data();
  });
  const quizSnap = await fb.sdk.getDocs(fb.sdk.collection(fb.db, "users", ctx.uid, "quizzes"));
  quizSnap.forEach((d) => {
    out.quizzes[d.id] = d.data();
  });
  const testSnap = await fb.sdk.getDocs(fb.sdk.collection(fb.db, "users", ctx.uid, "tests"));
  testSnap.forEach((d) => {
    out.tests[d.id] = d.data();
  });
  return out;
}

/**
 * Applies a whole remote snapshot.
 * mode "replace" throws away local pages; mode "merge" keeps the newer copy of
 * anything that exists on both sides.
 */
function applyRemoteSnapshot(remote, mode) {
  const s = store.state;
  if (mode === "replace") {
    s.pages = {};
    s.quizzes = {};
    s.tests = {};
  }

  for (const id in remote.pages) {
    const docData = remote.pages[id];
    if (!docData || docData.deleted) continue;
    const localPage = s.pages[id];
    if (!localPage || mode === "replace") {
      s.pages[id] = docData.data;
    } else {
      const localStamp = Number(localPage.updatedAt || localPage.createdAt || 0);
      if (Number(docData.updatedAtMs || 0) > localStamp) s.pages[id] = docData.data;
    }
  }

  ["quizzes", "tests"].forEach((kind) => {
    const map = remote[kind] || {};
    if (!s[kind] || typeof s[kind] !== "object") s[kind] = {};
    for (const id in map) {
      const docData = map[id];
      if (!docData || !docData.data) continue;
      const existing = s[kind][id];
      if (!existing || mode === "replace") s[kind][id] = docData.data;
      else if (Number(docData.updatedAtMs || 0) > Number(existing.finishedAt || existing.startedAt || 0)) {
        s[kind][id] = docData.data;
      }
    }
  });

  META_KEYS.forEach((key) => {
    const docData = remote.meta[key];
    if (!docData) return;
    if (mode === "replace") applyMetaPayload(key, docData.data);
    else if (key === "insights") mergeInsights(docData.data);
    else if (Number(docData.updatedAtMs || 0) > Date.now() - 0) applyMetaPayload(key, docData.data);
    else if (key === "workspace") mergeWorkspace(docData.data);
    else applyMetaPayload(key, docData.data);
  });

  setState(normalizeState(store.state));
  rebuildBaseFromRemote(remote);
  doSave();
  repaint();
}

function mergeWorkspace(data) {
  if (!data) return;
  const s = store.state;
  const seen = new Set(s.rootPageIds || []);
  (data.rootPageIds || []).forEach((id) => {
    if (!seen.has(id)) {
      s.rootPageIds.push(id);
      seen.add(id);
    }
  });
  s.expanded = Object.assign({}, data.expanded || {}, s.expanded || {});
}

function mergeInsights(data) {
  if (!data || !Array.isArray(data.insights)) return;
  const s = store.state;
  if (!Array.isArray(s.insights)) s.insights = [];
  const byKey = {};
  s.insights.forEach((i) => {
    if (i && i.key) byKey[i.key] = i;
  });
  data.insights.forEach((remoteInsight) => {
    if (!remoteInsight || !remoteInsight.key) return;
    const local = byKey[remoteInsight.key];
    if (!local) {
      s.insights.push(remoteInsight);
      byKey[remoteInsight.key] = remoteInsight;
      return;
    }
    // Keep the more recent sighting, and treat "resolved" as sticky only if it
    // happened after the other side last saw the gap.
    if (Number(remoteInsight.lastSeen || 0) > Number(local.lastSeen || 0)) {
      Object.assign(local, remoteInsight);
    }
  });
}

function rebuildBaseFromRemote(remote) {
  if (!ctx) return;
  ctx.base = { pages: {}, meta: {}, quizzes: {}, tests: {}, synced: true };
  for (const id in store.state.pages) {
    ctx.base.pages[id] = hashOf(store.state.pages[id]);
  }
  META_KEYS.forEach((key) => {
    ctx.base.meta[key] = hashOf(metaPayload(key));
  });
  ["quizzes", "tests"].forEach((kind) => {
    const map = collectionMap(kind);
    for (const id in map) ctx.base[kind][id] = hashOf(map[id]);
  });
  for (const id in remote.pages) {
    if (remote.pages[id] && typeof remote.pages[id].rev === "number") ctx.revs[id] = remote.pages[id].rev;
  }
  saveBase();
}

/** Pushes the whole local state up, replacing anything already there. */
async function pushEverything(deleteExtras) {
  if (!ctx) return;
  const fb = ctx.fb;
  status("syncing", "Uploading your notes\u2026");

  const ops = [];
  const now = Date.now();

  for (const id in store.state.pages) {
    const payload = pageDoc(store.state.pages[id], now);
    ctx.revs[id] = payload.rev;
    ops.push({
      ref: fb.sdk.doc(fb.db, "users", ctx.uid, "pages", id),
      payload: payload
    });
  }
  META_KEYS.forEach((key) => {
    ops.push({
      ref: fb.sdk.doc(fb.db, "users", ctx.uid, "meta", key),
      payload: { data: metaPayload(key), updatedAtMs: now, device: ctx.device }
    });
  });
  ["quizzes", "tests"].forEach((kind) => {
    const map = collectionMap(kind);
    for (const id in map) {
      ops.push({
        ref: fb.sdk.doc(fb.db, "users", ctx.uid, kind, id),
        payload: { data: map[id], updatedAtMs: now, device: ctx.device }
      });
    }
  });

  if (deleteExtras && deleteExtras.length) {
    for (const item of deleteExtras) {
      ops.push({
        ref: fb.sdk.doc(fb.db, "users", ctx.uid, item.kind, item.id),
        payload: { deleted: true, updatedAtMs: now, device: ctx.device }
      });
    }
  }

  await commit(ops);

  ctx.base = { pages: {}, meta: {}, quizzes: {}, tests: {}, synced: true };
  for (const id in store.state.pages) ctx.base.pages[id] = hashOf(store.state.pages[id]);
  META_KEYS.forEach((key) => {
    ctx.base.meta[key] = hashOf(metaPayload(key));
  });
  ["quizzes", "tests"].forEach((kind) => {
    const map = collectionMap(kind);
    for (const id in map) ctx.base[kind][id] = hashOf(map[id]);
  });
  saveBase();
  status("idle", "Synced");
}

/**
 * Called by the UI once the student picks how to handle a first sign-in where
 * both this device and the cloud already hold notes.
 * choice: "local" | "cloud" | "merge"
 */
export async function resolveInitialMerge(choice, remote) {
  if (!ctx) return { ok: false };
  try {
    if (choice === "cloud") {
      applyRemoteSnapshot(remote, "replace");
    } else if (choice === "merge") {
      applyRemoteSnapshot(remote, "merge");
      await pushEverything();
    } else {
      const extras = [];
      for (const id in remote.pages) {
        if (!store.state.pages[id]) extras.push({ kind: "pages", id });
      }
      await pushEverything(extras);
    }
    ctx.base.synced = true;
    saveBase();
    subscribe();
    startTimers();
    status("idle", "Synced");
    repaint();
    return { ok: true };
  } catch (e) {
    console.warn("[sync] merge failed", e);
    status("error", "Merge failed");
    return { ok: false, error: e && e.message };
  }
}

/* ------------------------------------------------------------------ *
 * pushing local changes
 * ------------------------------------------------------------------ */

function pageDoc(page, now) {
  return {
    data: page,
    hash: hashOf(page),
    title: page.title || "",
    parentId: page.parentId || null,
    updatedAtMs: now,
    updatedAt: ctx.fb.sdk.serverTimestamp(),
    rev: (ctx.revs[page.id] || 0) + 1,
    device: ctx.device,
    deleted: false
  };
}

async function commit(ops) {
  const fb = ctx.fb;
  for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
    const batch = fb.sdk.writeBatch(fb.db);
    ops.slice(i, i + BATCH_LIMIT).forEach((op) => batch.set(op.ref, op.payload, { merge: false }));
    await batch.commit();
  }
}

/** Debounced push. Called after every local save. */
export function scheduleFlush() {
  if (!ctx) return;
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => flushNow("debounce"), FLUSH_DEBOUNCE_MS);
}

let flushing = false;

/** Pushes anything that changed since the last successful push. */
export async function flushNow(reason) {
  if (!ctx || flushing || ctx.applying) return { ok: false };
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    status("offline", "Offline \u2014 saved on this device");
    return { ok: false };
  }

  const fb = ctx.fb;
  const now = Date.now();
  const ops = [];

  // pages: new or changed
  const seen = {};
  for (const id in store.state.pages) {
    const page = store.state.pages[id];
    const h = hashOf(page);
    seen[id] = h;
    if (ctx.base.pages[id] !== h) {
      ops.push({ ref: fb.sdk.doc(fb.db, "users", ctx.uid, "pages", id), payload: pageDoc(page, now), id, hash: h });
    }
  }
  // pages: deleted locally
  const deletions = [];
  for (const id in ctx.base.pages) {
    if (!(id in seen)) {
      deletions.push(id);
      ops.push({
        ref: fb.sdk.doc(fb.db, "users", ctx.uid, "pages", id),
        payload: { deleted: true, updatedAtMs: now, device: ctx.device, rev: (ctx.revs[id] || 0) + 1 },
        id,
        hash: null
      });
    }
  }

  // meta singletons
  const metaHashes = {};
  META_KEYS.forEach((key) => {
    const payload = metaPayload(key);
    const h = hashOf(payload);
    metaHashes[key] = h;
    if (ctx.base.meta[key] !== h) {
      ops.push({
        ref: fb.sdk.doc(fb.db, "users", ctx.uid, "meta", key),
        payload: { data: payload, updatedAtMs: now, device: ctx.device },
        metaKey: key,
        hash: h
      });
    }
  });

  // quiz + mock exam attempts
  const collHashes = { quizzes: {}, tests: {} };
  ["quizzes", "tests"].forEach((kind) => {
    const map = collectionMap(kind);
    for (const id in map) {
      const h = hashOf(map[id]);
      collHashes[kind][id] = h;
      if (ctx.base[kind][id] !== h) {
        ops.push({
          ref: fb.sdk.doc(fb.db, "users", ctx.uid, kind, id),
          payload: { data: map[id], updatedAtMs: now, device: ctx.device },
          kind,
          id,
          hash: h
        });
      }
    }
    for (const id in ctx.base[kind]) {
      if (!(id in collHashes[kind])) {
        ops.push({
          ref: fb.sdk.doc(fb.db, "users", ctx.uid, kind, id),
          payload: { deleted: true, updatedAtMs: now, device: ctx.device },
          kind,
          id,
          hash: null
        });
      }
    }
  });

  if (ops.length === 0) {
    if (reason !== "interval") status("idle", "Synced");
    await maybeMoveImages();
    return { ok: true, pushed: 0 };
  }

  flushing = true;
  status("syncing", "Syncing\u2026");
  try {
    await commit(ops);
    // Record what the cloud now holds.
    ctx.base.pages = seen;
    deletions.forEach((id) => {
      delete ctx.base.pages[id];
      ctx.revs[id] = (ctx.revs[id] || 0) + 1;
    });
    ops.forEach((op) => {
      if (op.payload && typeof op.payload.rev === "number" && op.id) ctx.revs[op.id] = op.payload.rev;
    });
    ctx.base.meta = metaHashes;
    ctx.base.quizzes = collHashes.quizzes;
    ctx.base.tests = collHashes.tests;
    ctx.base.synced = true;
    saveBase();
    status("idle", "Synced");
    await maybeMoveImages();
    return { ok: true, pushed: ops.length };
  } catch (e) {
    console.warn("[sync] push failed", e);
    status("error", navigator.onLine === false ? "Offline \u2014 saved on this device" : "Sync paused \u2014 will retry");
    return { ok: false, error: e && e.message };
  } finally {
    flushing = false;
  }
}

async function maybeMoveImages() {
  if (!ctx) return;
  try {
    const res = await runImageMigration(ctx.uid, () => {});
    if (res.moved > 0) {
      doSave();
      scheduleFlush();
    }
  } catch (e) {
    /* image offloading is best effort */
  }
}

/* ------------------------------------------------------------------ *
 * pulling remote changes
 * ------------------------------------------------------------------ */

function subscribe() {
  if (!ctx) return;
  const fb = ctx.fb;

  ctx.unsubs.push(
    fb.sdk.onSnapshot(
      fb.sdk.collection(fb.db, "users", ctx.uid, "pages"),
      (snap) => {
        let touched = 0;
        snap.docChanges().forEach((change) => {
          const data = change.doc.data();
          if (!data) return;
          if (data.device === ctx.device && data.hash && ctx.base.pages[change.doc.id] === data.hash) return;
          if (typeof data.rev === "number") ctx.revs[change.doc.id] = Math.max(ctx.revs[change.doc.id] || 0, data.rev);
          if (applyRemotePage(change.doc.id, data)) touched += 1;
        });
        if (touched > 0) {
          setState(normalizeState(store.state));
          doSave();
          saveBase();
          repaint();
        }
      },
      (err) => {
        console.warn("[sync] page listener error", err);
        status("error", "Sync paused \u2014 will retry");
      }
    )
  );

  ctx.unsubs.push(
    fb.sdk.onSnapshot(fb.sdk.collection(fb.db, "users", ctx.uid, "meta"), (snap) => {
      let touched = 0;
      snap.docChanges().forEach((change) => {
        const key = change.doc.id;
        if (META_KEYS.indexOf(key) === -1) return;
        const data = change.doc.data();
        if (!data || !data.data) return;
        const remoteHash = hashOf(data.data);
        if (ctx.base.meta[key] === remoteHash) return;
        const localHash = hashOf(metaPayload(key));
        if (localHash !== ctx.base.meta[key] && key === "insights") {
          mergeInsights(data.data); // both sides changed: union rather than clobber
        } else if (localHash === ctx.base.meta[key] || Number(data.updatedAtMs || 0) > Date.now() - 1000) {
          applyMetaPayload(key, data.data);
        } else {
          return;
        }
        ctx.base.meta[key] = hashOf(metaPayload(key));
        touched += 1;
      });
      if (touched > 0) {
        doSave();
        saveBase();
        repaint();
      }
    })
  );

  ["quizzes", "tests"].forEach((kind) => {
    ctx.unsubs.push(
      fb.sdk.onSnapshot(fb.sdk.collection(fb.db, "users", ctx.uid, kind), (snap) => {
        let touched = 0;
        snap.docChanges().forEach((change) => {
          const data = change.doc.data();
          const id = change.doc.id;
          if (!data) return;
          if (!store.state[kind] || typeof store.state[kind] !== "object") store.state[kind] = {};
          if (data.deleted) {
            if (store.state[kind][id]) {
              delete store.state[kind][id];
              delete ctx.base[kind][id];
              touched += 1;
            }
            return;
          }
          if (!data.data) return;
          const h = hashOf(data.data);
          if (ctx.base[kind][id] === h) return;
          const existing = store.state[kind][id];
          const existingStamp = existing ? Number(existing.finishedAt || existing.startedAt || 0) : -1;
          const remoteStamp = Number(data.data.finishedAt || data.data.startedAt || data.updatedAtMs || 0);
          if (!existing || remoteStamp >= existingStamp) {
            store.state[kind][id] = data.data;
            ctx.base[kind][id] = h;
            touched += 1;
          }
        });
        if (touched > 0) {
          doSave();
          saveBase();
          repaint();
        }
      })
    );
  });
}

/**
 * Merges one remote page document into local state.
 * @returns true when local state actually changed.
 */
function applyRemotePage(id, data) {
  const s = store.state;
  const localPage = s.pages[id];

  if (data.deleted) {
    if (!localPage) {
      delete ctx.base.pages[id];
      return false;
    }
    // Only honour a remote delete if we have no unsynced local edits.
    const localHash = hashOf(localPage);
    if (ctx.base.pages[id] && ctx.base.pages[id] !== localHash) return false;
    removePageLocally(id);
    delete ctx.base.pages[id];
    return true;
  }

  if (!data.data || typeof data.data !== "object") return false;
  const remotePage = data.data;

  if (!localPage) {
    s.pages[id] = remotePage;
    ctx.base.pages[id] = hashOf(remotePage);
    return true;
  }

  const localHash = hashOf(localPage);
  const remoteHash = data.hash || hashOf(remotePage);
  if (localHash === remoteHash) {
    ctx.base.pages[id] = localHash;
    return false;
  }

  const baseHash = ctx.base.pages[id];
  if (baseHash === localHash) {
    // Clean local copy - take the remote version.
    s.pages[id] = remotePage;
    ctx.base.pages[id] = remoteHash;
    return true;
  }

  // Both sides moved on. Keep the newer one and preserve the other.
  const remoteStamp = Number(data.updatedAtMs || 0);
  const localStamp = Number(localPage.updatedAt || localPage.createdAt || 0);
  if (remoteStamp >= localStamp) {
    makeConflictCopy(localPage);
    s.pages[id] = remotePage;
    ctx.base.pages[id] = remoteHash;
  } else {
    makeConflictCopy(remotePage);
    // local wins; the next flush pushes it over the remote copy
  }
  return true;
}

function shortDate() {
  const d = new Date();
  return d.getDate() + " " + ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()];
}

/** Never lose text: the losing side of a conflict becomes a sibling page. */
function makeConflictCopy(page) {
  const s = store.state;
  const copy = clone(page);
  copy.id = newId();
  copy.title = (page.title || "Untitled") + " (conflicted copy, " + shortDate() + ")";
  copy.createdAt = Date.now();
  copy.conflictOf = page.id;
  reassignBlockIds(copy.blocks);
  s.pages[copy.id] = copy;

  const parent = copy.parentId ? s.pages[copy.parentId] : null;
  if (parent && Array.isArray(parent.blocks)) {
    parent.blocks.push({ id: newId(), type: "page", childPageId: copy.id });
  } else if (!copy.parentId && Array.isArray(s.rootPageIds)) {
    s.rootPageIds.push(copy.id);
  }
  status("idle", "Kept a conflicted copy");
}

function reassignBlockIds(blocks) {
  if (!Array.isArray(blocks)) return;
  blocks.forEach((b) => {
    if (!b || typeof b !== "object") return;
    // Page blocks must keep pointing at the original child pages.
    b.id = newId();
    if (b.type === "toggle") reassignBlockIds(b.children);
  });
}

function removePageLocally(id) {
  const s = store.state;
  const page = s.pages[id];
  if (!page) return;
  const parent = page.parentId ? s.pages[page.parentId] : null;
  if (parent) removePageBlock(parent.blocks, id);
  delete s.pages[id];
  s.rootPageIds = (s.rootPageIds || []).filter((rid) => rid !== id);
  if (s.activePageId === id) s.activePageId = s.rootPageIds[0] || null;
}

function removePageBlock(blocks, childPageId) {
  if (!Array.isArray(blocks)) return false;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b && b.type === "page" && b.childPageId === childPageId) {
      blocks.splice(i, 1);
      return true;
    }
    if (b && b.type === "toggle" && removePageBlock(b.children, childPageId)) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ *
 * page timestamps
 * ------------------------------------------------------------------ */

/**
 * Stamps pages whose content changed so conflict resolution has something
 * meaningful to compare. Called from storage.doSave, before the cloud push.
 */
export function stampChangedPages() {
  if (!ctx) return;
  const now = Date.now();
  for (const id in store.state.pages) {
    const page = store.state.pages[id];
    const h = hashOf(page);
    if (ctx.base.pages[id] !== h && page.updatedAt !== now) {
      // Recompute after stamping so the hash we compare next time is stable.
      page.updatedAt = now;
    }
  }
}
