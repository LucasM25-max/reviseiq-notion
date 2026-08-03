// Local persistence. In the browser this uses localStorage, so notes stay on
// the device — no server or account needed for the Vercel deployment.
import { store, setState } from "./state.js";
import { createDefaultState, normalizeState } from "./model.js";

export const STORAGE_KEY = "reviseiq_state_v1";
const SAVE_DEBOUNCE_MS = 700;
// A heartbeat on top of the debounce: even during constant typing the
// workspace is written to localStorage at least this often.
const AUTOSAVE_INTERVAL_MS = 10000;
const SIZE_WARNING_BYTES = 4700000;

function storageAvailable() {
  try {
    const probe = "__reviseiq_probe__";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return true;
  } catch (e) {
    return false;
  }
}

const available = storageAvailable();

export function setSaveStatus(status, text) {
  const el = document.getElementById("save-status");
  const txt = document.getElementById("save-status-text");
  if (!el || !txt) return;
  el.className = "save-status " + status;
  txt.textContent = text;
}

/*
 * Hooks used by the cloud layer. They stay null for a local-only
 * deployment, which keeps storage.js free of any Firebase knowledge.
 */
let beforeSaveHook = null;
let afterSaveHook = null;

export function setBeforeSave(fn) {
  beforeSaveHook = typeof fn === "function" ? fn : null;
}

export function setAfterSave(fn) {
  afterSaveHook = typeof fn === "function" ? fn : null;
}

let saveTimer = null;
let autosaveStarted = false;

export function scheduleSave() {
  setSaveStatus("saving", "Saving\u2026");
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(doSave, SAVE_DEBOUNCE_MS);
}

export function doSave() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (beforeSaveHook) {
    try {
      beforeSaveHook();
    } catch (e) {
      console.warn("[storage] before-save hook failed", e);
    }
  }
  if (!available) {
    setSaveStatus("error", "Autosave unavailable here");
    return;
  }
  let json;
  try {
    json = JSON.stringify(store.state);
  } catch (e) {
    setSaveStatus("error", "Couldn't save");
    return;
  }
  if (json.length > SIZE_WARNING_BYTES) {
    setSaveStatus("full", "Storage nearly full");
    showFullBanner();
    return;
  }
  hideFullBanner();
  try {
    window.localStorage.setItem(STORAGE_KEY, json);
    setSaveStatus("saved", "Saved");
    if (afterSaveHook) {
      try {
        afterSaveHook();
      } catch (e) {
        console.warn("[storage] after-save hook failed", e);
      }
    }
  } catch (e) {
    setSaveStatus("full", "Storage full");
    showFullBanner();
  }
}

function showFullBanner() {
  if (document.getElementById("full-banner")) return;
  const d = document.createElement("div");
  d.id = "full-banner";
  d.className = "full-banner";
  d.textContent = "Storage is nearly full \u2014 try removing a few images to keep autosave working.";
  document.getElementById("overlay-root").appendChild(d);
}

function hideFullBanner() {
  const el = document.getElementById("full-banner");
  if (el) el.remove();
}

export function loadState() {
  if (!available) {
    setSaveStatus("error", "Autosave unavailable here");
    setState(createDefaultState());
    return;
  }
  setSaveStatus("saving", "Loading\u2026");
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    setState(raw ? normalizeState(JSON.parse(raw)) : createDefaultState());
    setSaveStatus("saved", raw ? "Saved" : "Ready");
  } catch (e) {
    setState(createDefaultState());
    setSaveStatus("saved", "Ready");
  }
}

/** Writes immediately instead of waiting out the debounce. */
export function flushSave() {
  if (!saveTimer) return;
  doSave();
}

/*
 * Belt and braces around the 700ms debounce: a heartbeat while the app is
 * open, plus an immediate write whenever the tab is being hidden, closed,
 * or comes back online. Nothing typed should ever be more than a few
 * seconds away from disk.
 */
export function initAutosave() {
  if (autosaveStarted) return;
  autosaveStarted = true;
  setInterval(() => flushSave(), AUTOSAVE_INTERVAL_MS);
  window.addEventListener("pagehide", flushSave);
  window.addEventListener("beforeunload", flushSave);
  window.addEventListener("online", flushSave);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushSave();
  });
}

// Handy for backups / debugging from the console.
export function exportStateJson() {
  return JSON.stringify(store.state, null, 2);
}
