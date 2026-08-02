// Service worker registration plus the small toasts around offline/update.
// Registration is deliberately quiet: nothing here should ever block boot.

function toast(message, actionLabel, onAction, autoHideMs) {
  const el = document.createElement("div");
  el.className = "pwa-toast";
  el.setAttribute("role", "status");
  const text = document.createElement("span");
  text.textContent = message;
  el.appendChild(text);
  if (actionLabel) {
    const btn = document.createElement("button");
    btn.textContent = actionLabel;
    btn.addEventListener("click", () => {
      el.remove();
      onAction();
    });
    el.appendChild(btn);
  }
  document.body.appendChild(el);
  if (autoHideMs) setTimeout(() => el.remove(), autoHideMs);
  return el;
}

export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  if (location.protocol !== "https:" && location.hostname !== "localhost") return;

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        reg.addEventListener("updatefound", () => {
          const incoming = reg.installing;
          if (!incoming) return;
          incoming.addEventListener("statechange", () => {
            // Only prompt when this is an update, not the very first install.
            if (incoming.state === "installed" && navigator.serviceWorker.controller) {
              toast("A new version of ReviseIQ is ready.", "Reload", () => {
                incoming.postMessage("skip-waiting");
                location.reload();
              });
            }
          });
        });
      })
      .catch(() => {
        /* offline support is a bonus; never surface a failure here */
      });
  });
}

export function initConnectivityNotices() {
  window.addEventListener("offline", () => {
    toast("Offline — your notes still save on this device.", null, null, 4000);
  });
}
