/*
 * Firebase Auth wrapper.
 *
 * Two ways in: Google sign-in (one tap for school Google accounts) and an
 * email sign-in link (no password to remember). Signed-out use is a first
 * class state - the app is fully usable without ever touching this file.
 */
import { getFirebase } from "./firebase.js";

const EMAIL_KEY = "reviseiq_signin_email";

const listeners = [];
let current = null; // the Firebase user, or null
let ready = false;
let startPromise = null;

function emit() {
  listeners.slice().forEach((fn) => {
    try {
      fn(current, ready);
    } catch (e) {
      console.warn("[auth] listener failed", e);
    }
  });
}

/** Subscribe to sign-in changes. Fires immediately with the current state. */
export function onAuthChange(fn) {
  listeners.push(fn);
  try {
    fn(current, ready);
  } catch (e) {
    /* ignore */
  }
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}

export function currentUser() {
  return current;
}

export function authReady() {
  return ready;
}

/** Boots Firebase and starts watching auth state. Safe to call repeatedly. */
export function initAuth() {
  if (startPromise) return startPromise;
  startPromise = (async () => {
    const fb = await getFirebase();
    if (!fb.ok) {
      ready = true;
      emit();
      return { ok: false, reason: fb.reason };
    }

    fb.sdk.onAuthStateChanged(fb.auth, (user) => {
      current = user || null;
      ready = true;
      emit();
    });

    // Returning from a redirect sign-in (used when a popup is blocked).
    fb.sdk.getRedirectResult(fb.auth).catch(() => null);

    // Returning from an email sign-in link.
    await completeEmailLinkSignIn(fb);

    return { ok: true };
  })();
  return startPromise;
}

export async function signInWithGoogle() {
  const fb = await getFirebase();
  if (!fb.ok) throw new Error("Cloud sync isn't set up for this deployment yet.");
  const provider = new fb.sdk.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  try {
    await fb.sdk.signInWithPopup(fb.auth, provider);
  } catch (e) {
    const code = (e && e.code) || "";
    if (code === "auth/popup-blocked" || code === "auth/operation-not-supported-in-this-environment") {
      await fb.sdk.signInWithRedirect(fb.auth, provider);
      return;
    }
    if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return;
    throw new Error(friendlyAuthError(e));
  }
}

/** Sends a one-time sign-in link to an email address. */
export async function sendLoginLink(email) {
  const fb = await getFirebase();
  if (!fb.ok) throw new Error("Cloud sync isn't set up for this deployment yet.");
  const clean = String(email || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) throw new Error("That doesn't look like an email address.");
  try {
    await fb.sdk.sendSignInLinkToEmail(fb.auth, clean, {
      url: window.location.origin + "/?signin=1",
      handleCodeInApp: true
    });
    window.localStorage.setItem(EMAIL_KEY, clean);
  } catch (e) {
    throw new Error(friendlyAuthError(e));
  }
}

/** If the page was opened from an email link, finish the sign-in. */
async function completeEmailLinkSignIn(fbMaybe) {
  const fb = fbMaybe || (await getFirebase());
  if (!fb.ok) return;
  let isLink = false;
  try {
    isLink = fb.sdk.isSignInWithEmailLink(fb.auth, window.location.href);
  } catch (e) {
    isLink = false;
  }
  if (!isLink) return;

  let email = window.localStorage.getItem(EMAIL_KEY) || "";
  if (!email) email = window.prompt("Confirm the email you used to request the sign-in link") || "";
  if (!email) return;

  try {
    await fb.sdk.signInWithEmailLink(fb.auth, email.trim(), window.location.href);
    window.localStorage.removeItem(EMAIL_KEY);
  } catch (e) {
    console.warn("[auth] email link sign-in failed", e);
  } finally {
    // Strip the one-time credentials out of the address bar either way.
    history.replaceState(null, "", window.location.pathname);
  }
}

export async function signOutNow() {
  const fb = await getFirebase();
  if (!fb.ok) return;
  await fb.sdk.signOut(fb.auth);
}

/** A fresh ID token, or null when signed out. Never throws. */
export async function getIdTokenSafe() {
  if (!current) return null;
  try {
    return await current.getIdToken();
  } catch (e) {
    return null;
  }
}

/**
 * Headers for calls to the app's own API. Adds the bearer token when signed
 * in so the Gemini endpoints can be locked down, and is a no-op otherwise.
 */
export async function authHeaders(base) {
  const headers = Object.assign({ "Content-Type": "application/json" }, base || {});
  const token = await getIdTokenSafe();
  if (token) headers.Authorization = "Bearer " + token;
  return headers;
}

function friendlyAuthError(e) {
  const code = (e && e.code) || "";
  if (code === "auth/network-request-failed") return "No connection - try again when you're back online.";
  if (code === "auth/too-many-requests") return "Too many attempts. Wait a minute and try again.";
  if (code === "auth/unauthorized-domain") {
    return "This domain isn't authorised in Firebase. Add it under Authentication \u203A Settings \u203A Authorized domains.";
  }
  if (code === "auth/invalid-email") return "That doesn't look like an email address.";
  if (code === "auth/operation-not-allowed") return "That sign-in method isn't enabled in Firebase yet.";
  return (e && e.message) || "Sign-in failed.";
}
