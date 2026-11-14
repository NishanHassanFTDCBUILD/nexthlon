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
