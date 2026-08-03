/*
 * Cloud wiring.
 *
 * This is the only file the rest of the app talks to. It boots Firebase (if
 * the deployment has it configured), keeps the sidebar account row in step,
 * and pushes local saves up on a short debounce plus a steady heartbeat.
 *
 * localStorage is untouched by all of this: it is still written first, still
 * written in full, and is still what the app reads on boot.
 */
import { loadCloudConfig } from "./config.js";
import { initAuth, onAuthChange } from "./auth.js";
import {
  startSync,
  stopSync,
  scheduleFlush,
  flushNow,
  setSyncRerender,
  onSyncStatus,
  resolveInitialMerge,
  stampChangedPages,
  isSyncing
} from "./sync.js";
import { setBeforeSave, setAfterSave } from "../storage.js";
import { setCloudUiEnabled, renderCloudRow, initCloudEvents, openMergeSheet, closeCloudSheet } from "./ui.js";
import { downloadBackup } from "../backup.js";

let started = false;

/**
 * @param options.rerender - repaint the sidebar and main view after remote
 *                           changes arrive.
 */
export async function initCloud(options) {
  if (started) return;
  started = true;

  const rerender = (options && options.rerender) || function () {};

  // Local saves stamp changed pages (for conflict resolution) and then queue a
  // push. Both are no-ops when signed out.
  setBeforeSave(() => {
    if (isSyncing()) stampChangedPages();
  });
  setAfterSave(() => {
    if (isSyncing()) scheduleFlush();
  });

  const cfg = await loadCloudConfig();
  if (!cfg.configured) {
    setCloudUiEnabled(false);
    return;
  }

  setCloudUiEnabled(true);
  initCloudEvents();
  setSyncRerender(rerender);
  onSyncStatus(() => renderCloudRow());

  onAuthChange(async (user, ready) => {
    renderCloudRow();
    if (!ready) return;
    if (!user) {
      await stopSync();
      renderCloudRow();
      return;
    }
    closeCloudSheet();
    const res = await startSync(user);
    if (res && res.needsChoice) {
      openMergeSheet({ localCount: res.localCount, remoteCount: res.remoteCount }, async (choice) => {
        // Safety net before anything is replaced.
        try {
          downloadBackup();
        } catch (e) {
          /* a blocked download must not stop the merge */
        }
        await resolveInitialMerge(choice, res.remote);
        rerender();
      });
    }
    renderCloudRow();
  });

  installFlushHooks();
  initAuth();
}

/* Push pending work at every natural pause, not just on the timer. */
function installFlushHooks() {
  window.addEventListener("online", () => flushNow("online"));
  window.addEventListener("pagehide", () => flushNow("pagehide"));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushNow("hidden");
  });
}

export { flushNow as syncNow };
