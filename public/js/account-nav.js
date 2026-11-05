// My Account: switch sections without reloading the page, and without any animation.
//
// Clicks on account links (the sidebar, the phone tab bar and links inside a section) fetch the
// URL with the header "X-Partial: 1". The server then sends only the section's content, which
// replaces the old content instantly. The URL, the page title, the active sidebar item and the
// focus follow; Back and Forward work. A small spinner shows only if a section takes over 300ms.
// Anything unexpected (signed out, an error page, a page that needs extra scripts) falls back to
// a normal page load, so the router can never leave the visitor stuck.
//
// Each section's script is a module in window.NxPages (see account.js): the old section's
// destroy() runs before the swap and the new section's init(root) after it.
(function () {
  "use strict";

  const main = document.querySelector("[data-acct-main]");
  if (!main || !window.fetch || !window.DOMParser || !history.pushState) return;

  const Pages = (window.NxPages = window.NxPages || {});
  const nav = document.querySelector("[data-acct-nav]");
  const SPINNER_DELAY = 300;
  // Account URLs the router may load: /account..., the short aliases, and one order's page.
  const ACCOUNT_PATH = /^\/(?:account(?:\/[\w-]+){0,2}|orders|wallet|profile|wishlist|orders\/NX-\d{4}-\d{6})\/?$/i;

  let active = null; // { name, root }
  let request = null; // the AbortController of the fetch in flight
  let shownUrl = location.pathname + location.search;

  const keyOf = url => url.pathname + url.search;
  function isAccountUrl(url) {
    return url.origin === location.origin && ACCOUNT_PATH.test(url.pathname);
  }

  // ---------- Section scripts ----------
  function start(root) {
    const page = Pages[root.dataset.acctPage];
    active = { root, page };
    if (page) page.init(root);
  }
  function stop() {
    if (active && active.page) active.page.destroy();
    active = null;
  }

  // ---------- The shell around the content ----------
  function markActive(section) {
    if (!nav) return;
    nav.querySelectorAll("[data-acct-link]").forEach(link => {
      const on = link.dataset.acctLink === section;
      link.classList.toggle("is-active", on);
      if (on) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
    if (window.NxAccount && window.NxAccount.showActiveTab) window.NxAccount.showActiveTab();
  }

  function focusHeading(root) {
    const heading = root.querySelector("h1") || root;
    if (!heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1");
    heading.focus({ preventScroll: true });
  }

  // The top of the content, just under the sticky header (or the phone tab bar).
  function contentTop() {
    const side = document.querySelector(".acct-side");
    const sticky = side && getComputedStyle(side).position === "sticky" && side.getBoundingClientRect().width >= main.getBoundingClientRect().width ? side.offsetHeight : 0;
    const header = document.querySelector("[data-site-header]");
    const headerFixed = header && getComputedStyle(header).position === "sticky" ? header.offsetHeight : 0;
    return Math.max(0, main.getBoundingClientRect().top + window.scrollY - Math.max(sticky, headerFixed) - 12);
  }

  function rememberScroll() {
    const state = history.state && history.state.nxAccount ? history.state : { nxAccount: true };
    history.replaceState({ ...state, scrollY: window.scrollY }, "", location.href);
  }

  // ---------- Loading a section ----------
  function fullLoad(url, mode) {
    if (mode === "pop") window.location.reload();
    else window.location.assign(url);
  }

  // mode: "push" (a click), "replace" (refresh the same section after a change), "pop" (Back/Forward).
  async function load(href, mode = "push") {
    const url = new URL(href, location.href);
    if (!isAccountUrl(url)) {
      fullLoad(url.href, mode);
      return;
    }
    if (request) request.abort();
    const controller = new AbortController();
    request = controller;
    const spinner = setTimeout(() => main.classList.add("is-loading"), SPINNER_DELAY);
    main.setAttribute("aria-busy", "true");
    try {
      const response = await fetch(url.href, {
        headers: { "X-Partial": "1", Accept: "text/html" },
        credentials: "same-origin",
        cache: "no-store",
        signal: controller.signal
      });
      const finalUrl = new URL(response.url || url.href);
      const html = await response.text();
      const fresh = new DOMParser().parseFromString(html, "text/html").querySelector("[data-acct-page]");
      // Signed out (sent to /login), an error page, or a page that must load in full.
      if (!response.ok || !fresh || fresh.dataset.acctFull === "1" || !isAccountUrl(finalUrl)) {
        fullLoad(url.href, mode);
        return;
      }
      if (controller.signal.aborted) return;
      if (mode === "push") rememberScroll();
      // A redirect (for example /wishlist answering as /account/lists) shows its final URL.
      if (!finalUrl.hash) finalUrl.hash = url.hash;
      swap(fresh, finalUrl.href, mode);
    } catch (error) {
      if (error && error.name === "AbortError") return;
      fullLoad(url.href, mode);
    } finally {
      clearTimeout(spinner);
      if (request === controller) {
        request = null;
        main.classList.remove("is-loading");
        main.removeAttribute("aria-busy");
      }
    }
  }

  function swap(fresh, href, mode) {
    const old = main.querySelector("[data-acct-page]");
    stop();
    const root = document.importNode(fresh, true);
    const title = root.dataset.acctTitle;
    root.removeAttribute("data-acct-title");
    old.replaceWith(root);
    if (title) document.title = title;

    if (mode === "push") history.pushState({ nxAccount: true, scrollY: 0 }, "", href);
    else if (mode === "replace") history.replaceState({ ...(history.state || {}), nxAccount: true }, "", href);
    shownUrl = keyOf(new URL(href, location.href));

    markActive(root.dataset.acctSection);
    start(root);

    // Scroll: the top of the content for a new section; where it was for Back/Forward; unchanged
    // when the same section refreshes after a change.
    if (mode === "push") {
      const hashTarget = location.hash && document.getElementById(decodeURIComponent(location.hash.slice(1)));
      if (hashTarget) hashTarget.scrollIntoView();
      else if (window.scrollY > contentTop()) window.scrollTo(0, contentTop());
    } else if (mode === "pop") {
      const saved = history.state && Number(history.state.scrollY);
      window.scrollTo(0, Number.isFinite(saved) ? saved : 0);
    }
    focusHeading(root);
  }

  // ---------- Links and GET forms ----------
  document.addEventListener("click", event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!link || !link.closest("[data-acct]")) return;
    if (link.target && link.target !== "_self") return;
    if (link.hasAttribute("download") || link.hasAttribute("data-full-load")) return;
    const url = new URL(link.href, location.href);
    if (!isAccountUrl(url)) return;
    // A link to a spot on this same section: the browser jumps there by itself.
    if (url.hash && keyOf(url) === shownUrl) return;
    event.preventDefault();
    load(url.href, "push");
  });

  // Search and filter forms inside a section (method GET with an action, e.g. Your orders).
  document.addEventListener("submit", event => {
    const form = event.target;
    if (event.defaultPrevented || !(form instanceof HTMLFormElement) || !form.closest("[data-acct-main]")) return;
    if (form.method.toLowerCase() !== "get" || !form.hasAttribute("action")) return;
    const url = new URL(form.action, location.href);
    if (!isAccountUrl(url)) return;
    event.preventDefault();
    const params = new URLSearchParams();
    for (const [key, value] of new FormData(form)) if (typeof value === "string" && value !== "") params.append(key, value);
    url.search = params.toString();
    load(url.href, "push");
  });

  // ---------- Back and Forward ----------
  window.addEventListener("popstate", () => {
    const here = new URL(location.href);
    if (keyOf(here) === shownUrl) return; // only the #hash changed
    load(here.href, "pop");
  });

  // ---------- Used by account.js after a change ----------
  window.NxAccountNav = {
    go: href => load(href, "push"),
    reload: () => load(location.href, "replace")
  };

  // ---------- Start ----------
  history.scrollRestoration = "manual";
  history.replaceState({ ...(history.state || {}), nxAccount: true, scrollY: window.scrollY }, "", location.href);
  window.addEventListener("pagehide", rememberScroll);
  // Deferred scripts have all run by now, so account.js has registered every section.
  document.addEventListener("DOMContentLoaded", () => {
    const root = main.querySelector("[data-acct-page]");
    if (root) start(root);
  });
})();
