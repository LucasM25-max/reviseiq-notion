/*
 * Lazy Firebase loader.
 *
 * ReviseIQ has no build step - it is plain ES modules served statically - so
 * the Firebase SDK is imported straight from Google's CDN, and only when the
 * project is actually configured. Nothing here runs for a signed-out,
 * local-only user beyond a single /api/config fetch.
 *
 * Transport note: Firestore normally talks over a streaming WebChannel. School
 * networks, filtered wifi and some corporate proxies block it, which shows up
 * as "unavailable" errors or writes that never settle. We can fall back to
 * plain long polling, and once that has been needed on a device we remember it
 * so later visits connect the slow-but-reliable way immediately.
 */
import { loadCloudConfig } from "./config.js";

export const FIREBASE_VERSION = "10.12.5";
const BASE = "https://www.gstatic.com/firebasejs/" + FIREBASE_VERSION + "/";
const LONG_POLL_KEY = "reviseiq_force_long_polling";

let bootPromise = null;
let cached = null;
let mods = null;
let cfgCache = null;
let appCounter = 0;

function longPollingRemembered() {
  try {
    return window.localStorage.getItem(LONG_POLL_KEY) === "1";
  } catch (e) {
    return false;
  }
}

function rememberLongPolling(on) {
  try {
    if (on) window.localStorage.setItem(LONG_POLL_KEY, "1");
    else window.localStorage.removeItem(LONG_POLL_KEY);
  } catch (e) {
    /* ignore */
  }
}

/** True once we are talking to Firestore over long polling. */
export function isLongPolling() {
  return Boolean(cached && cached.longPolling);
}

/**
 * Resolves with { ok, reason?, app, auth, db, storage, sdk } where sdk holds
 * the pieces of the modular API the rest of the cloud code needs.
 * Never rejects; check `ok`.
 */
export function getFirebase() {
  if (bootPromise) return bootPromise;
  bootPromise = boot().catch((e) => ({ ok: false, reason: e && e.message ? e.message : "unknown" }));
  return bootPromise;
}

function makeDb(fsMod, app, forceLongPolling) {
  const options = {
    localCache: fsMod.persistentLocalCache({ tabManager: fsMod.persistentMultipleTabManager() })
  };
  if (forceLongPolling) {
    // Deliberate, not a guess: stream detection has already failed here.
    options.experimentalForceLongPolling = true;
    options.useFetchStreams = false;
  } else {
    options.experimentalAutoDetectLongPolling = true;
  }
  try {
    return fsMod.initializeFirestore(app, options);
  } catch (e) {
    // Already initialised (hot reload) or IndexedDB blocked (private mode).
    try {
      const bare = forceLongPolling
        ? { experimentalForceLongPolling: true, useFetchStreams: false }
        : { experimentalAutoDetectLongPolling: true };
      return fsMod.initializeFirestore(app, bare);
    } catch (e2) {
      return fsMod.getFirestore(app);
    }
  }
}

async function boot() {
  const cfg = await loadCloudConfig();
  if (!cfg.configured || !cfg.firebase) {
    return { ok: false, reason: "not-configured" };
  }
  cfgCache = cfg;

  const [appMod, authMod, fsMod, storeMod] = await Promise.all([
    import(BASE + "firebase-app.js"),
    import(BASE + "firebase-auth.js"),
    import(BASE + "firebase-firestore.js"),
    import(BASE + "firebase-storage.js")
  ]);
  mods = { appMod, authMod, fsMod, storeMod };

  const app = appMod.getApps().length ? appMod.getApp() : appMod.initializeApp(cfg.firebase);
  const auth = authMod.getAuth(app);

  const forced = longPollingRemembered();
  const db = makeDb(fsMod, app, forced);
  const storage = storeMod.getStorage(app);

  cached = {
    ok: true,
    app,
    auth,
    db,
    storage,
    longPolling: forced,
    projectId: cfg.firebase.projectId,
    requireAuth: Boolean(cfg.requireAuth),
    sdk: {
      // auth
      onAuthStateChanged: authMod.onAuthStateChanged,
      GoogleAuthProvider: authMod.GoogleAuthProvider,
      signInWithPopup: authMod.signInWithPopup,
      signInWithRedirect: authMod.signInWithRedirect,
      getRedirectResult: authMod.getRedirectResult,
      sendSignInLinkToEmail: authMod.sendSignInLinkToEmail,
      isSignInWithEmailLink: authMod.isSignInWithEmailLink,
      signInWithEmailLink: authMod.signInWithEmailLink,
      signOut: authMod.signOut,
      // firestore
      doc: fsMod.doc,
      collection: fsMod.collection,
      getDoc: fsMod.getDoc,
      getDocs: fsMod.getDocs,
      setDoc: fsMod.setDoc,
      deleteDoc: fsMod.deleteDoc,
      onSnapshot: fsMod.onSnapshot,
      writeBatch: fsMod.writeBatch,
      serverTimestamp: fsMod.serverTimestamp,
      increment: fsMod.increment,
      query: fsMod.query,
      where: fsMod.where,
      limit: fsMod.limit,
      // storage
      ref: storeMod.ref,
      uploadString: storeMod.uploadString,
      uploadBytes: storeMod.uploadBytes,
      getDownloadURL: storeMod.getDownloadURL,
      deleteObject: storeMod.deleteObject
    }
  };
  return cached;
}

/**
 * Rebuilds Firestore on a fresh app instance with long polling forced on.
 * A Firestore instance cannot be reconfigured once created, hence the second
 * app. Auth, Storage and everything else carry on unchanged.
 *
 * @returns the updated firebase handle, or null if it could not be done.
 */
export async function switchToLongPolling() {
  const fb = await getFirebase();
  if (!fb.ok || !mods || !cfgCache) return null;
  if (fb.longPolling) return fb;

  try {
    appCounter += 1;
    const altApp = mods.appMod.initializeApp(cfgCache.firebase, "reviseiq-lp-" + appCounter);
    const db = makeDb(mods.fsMod, altApp, true);
    rememberLongPolling(true);
    cached = Object.assign({}, fb, { db, longPolling: true });
    bootPromise = Promise.resolve(cached);
    console.info("[firebase] switched to long polling (streaming transport looks blocked)");
    return cached;
  } catch (e) {
    console.warn("[firebase] could not switch to long polling", e);
    return null;
  }
}

/** Forget the long-polling preference, e.g. when moving to a normal network. */
export function clearLongPollingPreference() {
  rememberLongPolling(false);
}

/*
 * A plain REST call to Firestore, used only when something has gone wrong.
 * The streaming SDK reports almost every failure as "unavailable", which tells
 * a student nothing; this distinguishes "no database", "API switched off",
 * "rules reject me" and "the network is blocking Google".
 */
export async function probeFirestore() {
  const fb = await getFirebase();
  if (!fb.ok) return { reachable: false, reason: "not-configured", message: "Cloud sync isn't configured for this deployment." };

  const projectId = fb.projectId;
  const user = fb.auth && fb.auth.currentUser;
  let token = null;
  try {
    token = user ? await user.getIdToken() : null;
  } catch (e) {
    token = null;
  }

  const path = user ? "/users/" + user.uid : "";
  const url =
    "https://firestore.googleapis.com/v1/projects/" +
    encodeURIComponent(projectId) +
    "/databases/(default)/documents" +
    path;

  let res;
  let body = null;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: token ? { Authorization: "Bearer " + token } : {}
    });
    body = await res.json().catch(() => null);
  } catch (e) {
    return {
      reachable: false,
      reason: "network-blocked",
      message: "This network is blocking Google's servers. Try mobile data or another wifi."
    };
  }

  const text = JSON.stringify(body || {}).toLowerCase();

  if (res.ok) {
    return { reachable: true, reason: "ok", message: "Firestore is reachable." };
  }
  if (res.status === 404) {
    if (text.indexOf("database") > -1) {
      return {
        reachable: false,
        reason: "no-database",
        message: "No Firestore database in this project \u2014 create one in the console."
      };
    }
    // A missing document still means the backend answered us.
    return { reachable: true, reason: "ok-empty", message: "Firestore is reachable." };
  }
  if (res.status === 403) {
    if (text.indexOf("has not been used") > -1 || text.indexOf("service_disabled") > -1 || text.indexOf("disabled") > -1) {
      return {
        reachable: false,
        reason: "api-disabled",
        message: "Turn on the Cloud Firestore API for this project, then reload."
      };
    }
    return {
      reachable: true,
      reason: "rules",
      message: "Firestore rules are rejecting this account \u2014 publish firestore.rules."
    };
  }
  if (res.status === 401) {
    return { reachable: true, reason: "auth", message: "Sign out and back in to refresh your account." };
  }
  if (res.status === 400 && text.indexOf("datastore mode") > -1) {
    return {
      reachable: false,
      reason: "datastore-mode",
      message: "This project's database is in Datastore mode \u2014 it needs a Firestore Native database."
    };
  }
  return {
    reachable: false,
    reason: "http-" + res.status,
    message: "Firestore replied with an error (" + res.status + "). See the console for details."
  };
}
