/*
 * Account and sync UI: the sidebar row, the sign-in sheet, and the one-off
 * "you already have notes in both places" merge question.
 *
 * Everything here degrades to nothing when Firebase isn't configured, so a
 * plain local deployment looks exactly as it did before.
 */
import { ui } from "../icons.js";
import { escapeHtml } from "../utils.js";
import { currentUser, signInWithGoogle, sendLoginLink, signOutNow } from "./auth.js";
import { syncStatusNow, flushNow } from "./sync.js";

let enabled = false;
let busy = false;

export function setCloudUiEnabled(on) {
  enabled = Boolean(on);
  renderCloudRow();
}

function slot() {
  return document.getElementById("cloud-slot");
}

function initialFor(user) {
  const source = (user && (user.displayName || user.email)) || "?";
  return source.trim().charAt(0).toUpperCase() || "?";
}

export function renderCloudRow() {
  const el = slot();
  if (!el) return;
  if (!enabled) {
    el.innerHTML = "";
    return;
  }

  const user = currentUser();
  const st = syncStatusNow();

  if (!user) {
    el.innerHTML =
      '<button class="cloud-row cloud-row-out" id="cloud-signin-btn" title="Save your notes to your account">' +
      '<span class="cloud-row-icon">' +
      ui("cloud", 15) +
      "</span>" +
      '<span class="cloud-row-body">' +
      '<span class="cloud-row-title">Sign in to sync</span>' +
      '<span class="cloud-row-sub">Notes are saved on this device only</span>' +
      "</span></button>";
    return;
  }

  const label = user.displayName || user.email || "Signed in";
  el.innerHTML =
    '<div class="cloud-row cloud-row-in" id="cloud-account-row">' +
    '<span class="cloud-avatar">' +
    escapeHtml(initialFor(user)) +
    "</span>" +
    '<span class="cloud-row-body">' +
    '<span class="cloud-row-title">' +
    escapeHtml(label) +
    "</span>" +
    '<span class="cloud-row-sub cloud-sync-state ' +
    escapeHtml(st.state) +
    '">' +
    escapeHtml(st.text || "") +
    "</span></span>" +
    '<button class="cloud-mini-btn" data-cloud-act="sync" title="Sync now">' +
    ui("refresh", 13) +
    "</button>" +
    '<button class="cloud-mini-btn" data-cloud-act="signout" title="Sign out">' +
    ui("signout", 13) +
    "</button></div>";
}

/* ---------------- sign-in sheet ---------------- */

function closeSheet() {
  const el = document.getElementById("cloud-sheet");
  if (el) el.remove();
}

export function openSignInSheet() {
  closeSheet();
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.id = "cloud-sheet";
  wrap.innerHTML =
    '<div class="modal cloud-modal" role="dialog" aria-modal="true" aria-label="Sign in">' +
    '<div class="cloud-modal-head">' +
    '<span class="cloud-modal-icon">' +
    ui("cloud", 18) +
    "</span>" +
    "<div><h3>Sync your revision</h3>" +
    "<p>Sign in and every note, flashcard, quiz and mock exam follows you to your phone. Your notes stay saved on this device too.</p></div>" +
    "</div>" +
    '<button class="cloud-google" data-cloud-act="google">' +
    '<svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.2c0-.7-.06-1.36-.18-2H12v3.79h5.4a4.6 4.6 0 0 1-2 3.02v2.5h3.23c1.9-1.74 2.97-4.3 2.97-7.31Z"/><path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.62-2.43l-3.23-2.5c-.9.6-2.05.96-3.39.96-2.6 0-4.8-1.76-5.59-4.12H3.07v2.59A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.41 13.9a6 6 0 0 1 0-3.82V7.49H3.07a10 10 0 0 0 0 9.02l3.34-2.6Z"/><path fill="#EA4335" d="M12 5.98c1.47 0 2.78.5 3.82 1.5l2.86-2.86C16.95 2.99 14.7 2 12 2A10 10 0 0 0 3.07 7.49l3.34 2.59C7.2 7.73 9.4 5.98 12 5.98Z"/></svg>' +
    "Continue with Google</button>" +
    '<div class="cloud-or"><span>or</span></div>' +
    '<label class="cloud-label" for="cloud-email">Email me a sign-in link</label>' +
    '<div class="cloud-email-row">' +
    '<input type="email" id="cloud-email" class="cloud-input" placeholder="you@school.uk" autocomplete="email" spellcheck="false" />' +
    '<button class="btn-primary" data-cloud-act="email">Send link</button>' +
    "</div>" +
    '<div class="cloud-msg" id="cloud-msg" hidden></div>' +
    '<div class="modal-actions"><button class="btn-cancel" data-cloud-act="close">Not now</button></div>' +
    "</div>";
  document.getElementById("overlay-root").appendChild(wrap);
  const input = document.getElementById("cloud-email");
  if (input) input.focus();
}

function sheetMessage(text, kind) {
  const el = document.getElementById("cloud-msg");
  if (!el) return;
  el.hidden = false;
  el.className = "cloud-msg " + (kind || "info");
  el.textContent = text;
}

/* ---------------- first-run merge question ---------------- */

let mergeHandler = null;

export function openMergeSheet(info, onChoice) {
  mergeHandler = onChoice;
  closeSheet();
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.id = "cloud-sheet";
  wrap.innerHTML =
    '<div class="modal cloud-modal" role="dialog" aria-modal="true" aria-label="Choose what to keep">' +
    "<h3>You have notes in two places</h3>" +
    "<p>This device has <strong>" +
    info.localCount +
    " page" +
    (info.localCount === 1 ? "" : "s") +
    "</strong> and your account has <strong>" +
    info.remoteCount +
    " page" +
    (info.remoteCount === 1 ? "" : "s") +
    "</strong>. This is asked once.</p>" +
    '<div class="cloud-choices">' +
    '<button class="cloud-choice" data-cloud-merge="merge"><span class="cloud-choice-title">Merge them</span>' +
    '<span class="cloud-choice-sub">Keep everything. Where a page exists in both, the newer version wins. Recommended.</span></button>' +
    '<button class="cloud-choice" data-cloud-merge="local"><span class="cloud-choice-title">Keep this device</span>' +
    '<span class="cloud-choice-sub">Replace what is in the account with what is on this device.</span></button>' +
    '<button class="cloud-choice" data-cloud-merge="cloud"><span class="cloud-choice-title">Keep the account</span>' +
    '<span class="cloud-choice-sub">Replace what is on this device with what is in the account.</span></button>' +
    "</div>" +
    '<p class="cloud-fineprint">A JSON backup of this device is downloaded first either way.</p>' +
    "</div>";
  document.getElementById("overlay-root").appendChild(wrap);
}

/* ---------------- events ---------------- */

export function initCloudEvents() {
  document.addEventListener("click", async (e) => {
    const signIn = e.target.closest("#cloud-signin-btn");
    if (signIn) {
      openSignInSheet();
      return;
    }

    const merge = e.target.closest("[data-cloud-merge]");
    if (merge) {
      const choice = merge.dataset.cloudMerge;
      merge.closest(".cloud-choices").querySelectorAll("button").forEach((b) => (b.disabled = true));
      if (typeof mergeHandler === "function") await mergeHandler(choice);
      closeSheet();
      return;
    }

    const act = e.target.closest("[data-cloud-act]");
    if (!act) return;
    const which = act.dataset.cloudAct;

    if (which === "close") {
      closeSheet();
      return;
    }
    if (which === "sync") {
      act.classList.add("is-spinning");
      await flushNow("manual");
      act.classList.remove("is-spinning");
      renderCloudRow();
      return;
    }
    if (which === "signout") {
      await signOutNow();
      return;
    }
    if (which === "google") {
      if (busy) return;
      busy = true;
      sheetMessage("Opening Google\u2026", "info");
      try {
        await signInWithGoogle();
        closeSheet();
      } catch (err) {
        sheetMessage(err.message || "Sign-in failed.", "error");
      } finally {
        busy = false;
      }
      return;
    }
    if (which === "email") {
      if (busy) return;
      const input = document.getElementById("cloud-email");
      const value = input ? input.value : "";
      busy = true;
      sheetMessage("Sending\u2026", "info");
      try {
        await sendLoginLink(value);
        sheetMessage("Link sent. Open it on this device to finish signing in.", "ok");
      } catch (err) {
        sheetMessage(err.message || "Couldn't send that link.", "error");
      } finally {
        busy = false;
      }
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && document.getElementById("cloud-sheet") && !mergeSheetOpen()) closeSheet();
  });
}

function mergeSheetOpen() {
  return Boolean(document.querySelector("[data-cloud-merge]"));
}

export function closeCloudSheet() {
  closeSheet();
}
