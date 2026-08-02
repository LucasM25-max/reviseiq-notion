/*
 * ReviseIQ service worker.
 *
 * The app is a static shell with all data in localStorage, so once the shell
 * is cached the app works with no network at all. Strategy:
 *   - navigations: network first, fall back to the cached shell when offline
 *   - same-origin assets: stale-while-revalidate (instant load, quiet update)
 * Bump CACHE_VERSION whenever the shell changes so old caches are dropped.
 */
const CACHE_VERSION = "reviseiq-v3";
const SHELL = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/favicon.png",
  "/assets/logo-128.png",
  "/assets/logo-512.png",
  "/styles/base.css",
  "/styles/sidebar.css",
  "/styles/main.css",
  "/styles/blocks.css",
  "/styles/overlays.css",
  "/styles/icons.css",
  "/styles/toc.css",
  "/styles/revise.css",
  "/styles/today.css",
  "/styles/mobile.css",
  "/src/main.js",
  "/src/state.js",
  "/src/model.js",
  "/src/storage.js",
  "/src/utils.js",
  "/src/icons.js",
  "/src/blocks.js",
  "/src/blockTypes.js",
  "/src/exams.js",
  "/src/focus.js",
  "/src/pages.js",
  "/src/overlays.js",
  "/src/srs.js",
  "/src/backup.js",
  "/src/pwa.js",
  "/src/render/main.js",
  "/src/render/blocks.js",
  "/src/render/sidebar.js",
  "/src/render/calendar.js",
  "/src/render/toc.js",
  "/src/render/revise.js",
  "/src/render/today.js",
  "/src/events/mainEvents.js",
  "/src/events/sidebarEvents.js",
  "/src/events/mobileEvents.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      // addAll is atomic: one 404 would fail the whole install, so add
      // individually and tolerate misses.
      .then((cache) => Promise.all(SHELL.map((url) => cache.add(url).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put("/index.html", copy));
          return res;
        })
        .catch(() => caches.match("/index.html").then((hit) => hit || caches.match("/")))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((hit) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => hit);
      return hit || network;
    })
  );
});
