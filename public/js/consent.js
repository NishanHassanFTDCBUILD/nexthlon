// Cookie consent and analytics (D2). Only on the page when the store owner set up a provider
// (utils/analytics.js). Nothing from the provider loads until the visitor picks "Allow analytics".
// The choice is kept for 180 days in the nx_consent cookie ("analytics" or "essential").
// Browsers that send Global Privacy Control count as "essential", and the banner is not shown.
//
// Shopping events: Nx.track(name, params) from the store's scripts, plus any events a page lists in
// <script type="application/json" id="nx-events">. Before consent they are simply dropped.
(function () {
  "use strict";
  const script = document.currentScript;
  const Nx = (window.Nx = window.Nx || {});
  const cfg = script ? { provider: script.dataset.provider, id: script.dataset.id, host: script.dataset.host } : {};
  const metaId = script ? script.dataset.metaPixel || "" : "";
  const COOKIE = "nx_consent";
  const banner = document.getElementById("consent");
  let loaded = false;

  const read = () => {
    const match = document.cookie.match(/(?:^|;\s*)nx_consent=(analytics|essential)/);
    return match ? match[1] : "";
  };
  const write = value => {
    const secure = location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${COOKIE}=${value}; Max-Age=${180 * 24 * 3600}; Path=/; SameSite=Lax${secure}`;
  };

  // Meta Pixel (optional): loaded only after "Allow analytics", like the analytics provider.
  function loadMetaPixel() {
    const id = metaId;
    if (!id || !/^[0-9]{8,20}$/.test(id) || window.fbq) return;
    /* eslint-disable */
    !function (f, b, e, v, n, t, s) { if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); }; if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = "2.0"; n.queue = []; t = b.createElement(e); t.async = !0; t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s); }(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");
    /* eslint-enable */
    window.fbq("init", id);
    window.fbq("track", "PageView");
  }

  function load() {
    loadMetaPixel();
    if (loaded || !cfg.provider || !cfg.id) return;
    loaded = true;
    const tag = document.createElement("script");
    tag.async = true;
    if (cfg.provider === "ga4") {
      window.dataLayer = window.dataLayer || [];
      window.gtag = function gtag() { window.dataLayer.push(arguments); };
      window["ga-disable-" + cfg.id] = false;
      window.gtag("js", new Date());
      // No ad features, no personalisation signals: counting visits only.
      window.gtag("config", cfg.id, { allow_google_signals: false, allow_ad_personalization_signals: false });
      tag.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(cfg.id);
    } else if (cfg.provider === "plausible") {
      window.plausible = window.plausible || function () { (window.plausible.q = window.plausible.q || []).push(arguments); };
      tag.dataset.domain = cfg.id;
      tag.src = cfg.host + "/js/script.js";
    }
    document.head.appendChild(tag);
  }

  // Plausible only takes flat text or number properties.
  const flat = params => {
    const out = {};
    Object.entries(params || {}).forEach(([key, value]) => {
      if (typeof value === "string" || typeof value === "number") out[key] = value;
    });
    return out;
  };

  Nx.track = function track(name, params = {}) {
    if (read() !== "analytics" || !loaded) return;
    try {
      if (cfg.provider === "ga4" && window.gtag) window.gtag("event", name, params);
      if (window.fbq) {
        // Meta's standard event names for the same shopping moments.
        const META = { view_item: "ViewContent", add_to_cart: "AddToCart", begin_checkout: "InitiateCheckout", purchase: "Purchase" };
        if (META[name]) window.fbq("track", META[name], { value: params.value, currency: params.currency || "INR", content_type: "product" });
      }
      if (cfg.provider === "plausible" && window.plausible) {
        const props = flat(params);
        const revenue = typeof params.value === "number" && params.currency ? { amount: params.value, currency: params.currency } : undefined;
        window.plausible(name, revenue ? { props, revenue } : { props });
      }
    } catch { /* analytics must never break the store */ }
  };

  function pageEvents() {
    const node = document.getElementById("nx-events");
    if (!node) return;
    let events = [];
    try { events = JSON.parse(node.textContent || "[]"); } catch { return; }
    events.forEach(event => {
      if (!event || !event.name) return;
      if (event.once) {
        // Sent once per browser (a reloaded thank-you page is not a second sale).
        try {
          if (localStorage.getItem("nx-sent:" + event.once)) return;
          localStorage.setItem("nx-sent:" + event.once, "1");
        } catch { /* storage blocked: send anyway */ }
      }
      Nx.track(event.name, event.params);
    });
  }

  function show() {
    if (!banner) return;
    banner.hidden = false;
    requestAnimationFrame(() => banner.classList.add("is-in"));
  }
  function hide() {
    if (!banner) return;
    banner.classList.remove("is-in");
    window.setTimeout(() => { banner.hidden = true; }, 260);
  }

  function choose(value) {
    const before = read();
    write(value);
    hide();
    if (value === "analytics") {
      load();
      pageEvents();
    } else if (before === "analytics" && cfg.provider === "ga4") {
      // Withdrawn: stop sending now and remove Google's cookies from this site.
      window["ga-disable-" + cfg.id] = true;
      document.cookie.split(";").map(c => c.trim().split("=")[0]).filter(n => /^_ga/.test(n)).forEach(n => {
        document.cookie = `${n}=; Max-Age=0; Path=/`;
        document.cookie = `${n}=; Max-Age=0; Path=/; Domain=.${location.hostname.replace(/^www\./, "")}`;
      });
    }
    if (before && before !== value && Nx.toast) Nx.toast(value === "analytics" ? "Analytics allowed. Thank you." : "Only essential cookies from now on.");
  }

  document.addEventListener("click", event => {
    const pick = event.target.closest("[data-consent]");
    if (pick) { choose(pick.dataset.consent); return; }
    if (event.target.closest("[data-consent-open]")) show();
  });

  const choice = read();
  if (choice === "analytics") {
    load();
    pageEvents();
  } else if (!choice) {
    if (navigator.globalPrivacyControl === true) write("essential");
    else show();
  }
})();
