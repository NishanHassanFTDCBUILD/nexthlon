// The installable app (E5): registers the service worker (public/sw.js) and runs "Get the app".
// Browsers that can install (Chrome, Edge, Samsung Internet on Android and desktop) fire
// "beforeinstallprompt"; the footer button then opens their own install dialog. iPhones cannot be asked
// from a page, so there the button explains the two taps (Share, then Add to Home Screen).
// Nothing shows inside the installed app itself.
(function () {
  "use strict";
  const Nx = window.Nx || {};
  const standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  const buttons = () => document.querySelectorAll("[data-install-app]");
  const show = on => buttons().forEach(button => { button.hidden = !on; });

  // Service workers need a secure page (https, or localhost while building).
  if ("serviceWorker" in navigator && window.isSecureContext) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => { /* the store works without it */ });
    }, { once: true });
  }

  if (standalone) return;

  let deferred = null;
  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    deferred = event;
    show(true);
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    show(false);
    if (Nx.toast) Nx.toast("Nexthlon is on your home screen. See you there!");
  });

  const ua = navigator.userAgent || "";
  const iPhone = /iPhone|iPad|iPod/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
  if (iPhone) show(true);

  document.addEventListener("click", async event => {
    const button = event.target.closest("[data-install-app]");
    if (!button) return;
    if (deferred) {
      const prompt = deferred;
      deferred = null;
      prompt.prompt();
      const { outcome } = await prompt.userChoice.catch(() => ({ outcome: "dismissed" }));
      if (outcome === "accepted") show(false);
      return;
    }
    if (iPhone && Nx.toast) {
      Nx.toast("Tap the Share button, then \"Add to Home Screen\". Nexthlon opens like an app from there.", "info");
    }
  });
})();

// ---------- Push notifications (E5) ----------
// The switch on My Account > Notifications. Shown only where the browser can do push and the store has
// keys; turning it on asks the browser first (its own permission prompt), then saves the device.
(function () {
  "use strict";
  const box = document.querySelector("[data-push-box]");
  const toggle = box && box.querySelector("[data-push-toggle]");
  if (!toggle || !("serviceWorker" in navigator) || !("PushManager" in window) || !window.isSecureContext) return;
  const Nx = window.Nx || {};
  const note = box.querySelector("[data-push-note]");
  const toKey = base64 => {
    const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
    return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
  };

  (async () => {
    let key;
    try { key = (await Nx.api("/api/push/key")).publicKey; } catch { return; }
    box.hidden = false;
    const registration = await navigator.serviceWorker.ready;
    let current = await registration.pushManager.getSubscription();
    toggle.checked = Boolean(current) && Notification.permission === "granted";
    if (Notification.permission === "denied") {
      toggle.disabled = true;
      note.textContent = "Notifications are blocked for this site in your browser settings. Allow them there to turn this on.";
    }

    toggle.addEventListener("change", async () => {
      toggle.disabled = true;
      try {
        if (toggle.checked) {
          const permission = await Notification.requestPermission();
          if (permission !== "granted") throw new Error("Notifications were not allowed.");
          current = current || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(key) });
          const reply = await Nx.api("/api/push/subscribe", { method: "POST", body: current.toJSON() });
          Nx.toast(reply.message);
        } else if (current) {
          await Nx.api("/api/push/subscribe", { method: "DELETE", body: { endpoint: current.endpoint } });
          await current.unsubscribe();
          current = null;
          Nx.toast("Notifications are off for this device.");
        }
      } catch (error) {
        toggle.checked = !toggle.checked;
        Nx.toast(error.message, "error");
      } finally {
        toggle.disabled = Notification.permission === "denied";
      }
    });
  })();
})();
