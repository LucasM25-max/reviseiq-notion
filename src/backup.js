// Backup & restore. Everything lives in this browser's localStorage, so a
// one-click JSON export is the safety net against a cleared cache.
import { store, setState } from "./state.js";
import { normalizeState } from "./model.js";
import { doSave, setSaveStatus } from "./storage.js";
import { pad2 } from "./utils.js";

export const BACKUP_FORMAT = "reviseiq.backup";
export const BACKUP_VERSION = 1;

function stamp() {
  const d = new Date();
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
}

export function buildBackup() {
  return JSON.stringify(
    { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: new Date().toISOString(), state: store.state },
    null,
    2
  );
}

export function downloadBackup() {
  const blob = new Blob([buildBackup()], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "reviseiq-backup-" + stamp() + ".json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  setSaveStatus("saved", "Backup downloaded");
}

/** Reads a chosen .json file and returns the state it contains. */
export function readBackupFile(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error("No file chosen."));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Couldn't read that file."));
    reader.onload = () => {
      let parsed;
      try {
        parsed = JSON.parse(reader.result);
      } catch (e) {
        reject(new Error("That file isn't a valid ReviseIQ backup."));
        return;
      }
      const raw = parsed && parsed.state ? parsed.state : parsed;
      if (!raw || typeof raw !== "object" || !raw.pages) {
        reject(new Error("That file isn't a valid ReviseIQ backup."));
        return;
      }
      resolve(normalizeState(raw));
    };
    reader.readAsText(file);
  });
}

export function summarise(state) {
  const pageCount = Object.keys(state.pages || {}).length;
  const subjectCount = (state.rootPageIds || []).length;
  return (
    subjectCount + " subject" + (subjectCount === 1 ? "" : "s") + " and " + pageCount + " page" + (pageCount === 1 ? "" : "s")
  );
}

export function applyRestore(nextState) {
  setState(nextState);
  if (!store.state.activePageId || !store.state.pages[store.state.activePageId]) {
    store.state.activePageId = store.state.rootPageIds[0] || null;
  }
  store.currentView = "page";
  doSave();
}
