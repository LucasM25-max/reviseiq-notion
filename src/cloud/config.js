// Fetches the public Firebase web config from /api/config, with a localStorage
// cache so a cold start offline still knows whether sync is set up.
const CACHE_KEY = "reviseiq_cloud_config_v1";

let cached = null;
let inflight = null;

function readCache() {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch (e) {
    return null;
  }
}

function writeCache(cfg) {
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(cfg));
  } catch (e) {
    /* cache is a nicety, never fatal */
  }
}

/**
 * Resolves with { configured, requireAuth, firebase }.
 * Never rejects - if the network is down we fall back to the cached copy, and
 * failing that report "not configured" so the app stays local-only.
 */
export function loadCloudConfig() {
  if (cached) return Promise.resolve(cached);
  if (inflight) return inflight;

  inflight = fetch("/api/config", { headers: { Accept: "application/json" } })
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error("bad status"))))
    .then((cfg) => {
      if (!cfg || typeof cfg !== "object") throw new Error("bad body");
      cached = cfg;
      if (cfg.configured) writeCache(cfg);
      return cfg;
    })
    .catch(() => {
      const fallback = readCache();
      cached = fallback || { configured: false, requireAuth: false, firebase: null };
      return cached;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

/** Synchronous peek, used by code that cannot await (e.g. request headers). */
export function cloudConfigNow() {
  return cached || readCache() || { configured: false, requireAuth: false, firebase: null };
}
