/*
 * Lazy Firebase loader.
 *
 * ReviseIQ has no build step - it is plain ES modules served statically - so
 * the Firebase SDK is imported straight from Google's CDN, and only when the
 * project is actually configured. Nothing here runs for a signed-out,
 * local-only user beyond a single /api/config fetch.
 */
import { loadCloudConfig } from "./config.js";

export const FIREBASE_VERSION = "10.12.5";
const BASE = "https://www.gstatic.com/firebasejs/" + FIREBASE_VERSION + "/";

let bootPromise = null;

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

async function boot() {
  const cfg = await loadCloudConfig();
  if (!cfg.configured || !cfg.firebase) {
    return { ok: false, reason: "not-configured" };
  }

  const [appMod, authMod, fsMod, storeMod] = await Promise.all([
    import(BASE + "firebase-app.js"),
    import(BASE + "firebase-auth.js"),
    import(BASE + "firebase-firestore.js"),
    import(BASE + "firebase-storage.js")
  ]);

  const app = appMod.getApps().length ? appMod.getApp() : appMod.initializeApp(cfg.firebase);
  const auth = authMod.getAuth(app);

  // Offline persistence: Firestore keeps its own IndexedDB mirror, so queued
  // writes survive a refresh and reads work with no connection. localStorage
  // remains the primary copy regardless - this is belt and braces.
  let db;
  try {
    db = fsMod.initializeFirestore(app, {
      localCache: fsMod.persistentLocalCache({ tabManager: fsMod.persistentMultipleTabManager() })
    });
  } catch (e) {
    // Already initialised (hot reload) or IndexedDB blocked (private mode).
    db = fsMod.getFirestore(app);
  }

  const storage = storeMod.getStorage(app);

  return {
    ok: true,
    app,
    auth,
    db,
    storage,
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
}
