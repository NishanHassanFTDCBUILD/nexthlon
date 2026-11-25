// Section router for the work areas (My Account and the admin console): switch sections without
// reloading the page, and without any animation.
//
// Clicks on area links (the sidebar, the tab bar and links inside a section) and the area's GET
// forms fetch the URL with the header "X-Partial: 1". The server then sends only the section's
// content, which replaces the old content instantly. The URL, the page title, the active sidebar
// item and the focus follow; Back and Forward work. A small spinner shows only after 300ms.
// Anything unexpected (signed out, an error page, a page that needs extra scripts) falls back to a
// normal page load, so the router can never leave anyone stuck.
//
// Markup:  <div data-nav-main="account|admin">  the content holder
//            <div data-page="account-wallet" data-section="wallet">  the section (swapped)
//          <a data-nav-link="wallet">  sidebar links, marked active by section
//
// Each section's script is a module in window.NxPages with init(root) and destroy(): the old
// section's destroy() runs before the swap and the new section's init(root) after it.
(function () {
  'use strict';

  // ---------- The section registry (also used without the router) ----------
  const Pages = (window.NxPages = window.NxPages || {});
  // NxPages.define(name, setup): setup(root, signal) attaches the section's listeners and may
  // return a cleanup function. Listeners added with { signal } are removed by destroy().
  if (!Pages.define) {
    Object.defineProperty(Pages, 'define', {
      enumerable: false,
      value(name, setup) {
        let controller = null;
        let cleanup = null;
        Pages[name] = {
          init(root) {
            this.destroy();
            controller = new AbortController();
            const result = setup(root, controller.signal);
            cleanup = typeof result === 'function' ? result : null;
          },
          destroy() {
            if (controller) controller.abort();
            if (cleanup) cleanup();
            controller = null;
            cleanup = null;
          },
        };
      },
    });
  }

  const main = document.querySelector('[data-nav-main]');
  if (!main || !window.fetch || !window.DOMParser || !history.pushState) return;

  // Which URLs belong to this area, and so may be loaded into it.
  const area = main.dataset.navMain;
  const adminBase = (document.body.dataset.adminPath || '').toLowerCase();
  const ACCOUNT_PATH =
    /^\/(?:account(?:\/[\w-]+){0,2}|orders|wallet|profile|wishlist|orders\/NX-\d{4}-\d{6})\/?$/i;
  function inArea(url) {
    if (url.origin !== location.origin) return false;
    const path = url.pathname.toLowerCase();
    if (area === 'account') return ACCOUNT_PATH.test(url.pathname);
    if (area === 'admin')
      return (
        Boolean(adminBase) &&
        path.startsWith(`${adminBase}/`) &&
        path !== `${adminBase}/login` &&
        !/\.(pdf|csv|xlsx)$/.test(path)
      );
    return false;
  }

  const SPINNER_DELAY = 300;
  let active = null; // { root, page }
  let request = null; // the AbortController of the fetch in flight
  const keyOf = (url) => url.pathname + url.search;
  let shownUrl = keyOf(location);
  let askingToLeave = false;
  const unsaved = () => main.querySelector('[data-unsaved="true"]');
  window.addEventListener('beforeunload', (event) => {
    if (
      !unsaved() &&
      !main.querySelector('[data-pending="true"]') &&
      !window.Nx.hasPendingAdminWrites?.()
    )
      return;
    event.preventDefault();
    event.returnValue = '';
  });

  // ---------- Section scripts ----------
  function start(root) {
    const page = Pages[root.dataset.page];
    active = {root, page};
    if (page) page.init(root);
  }
  function stop() {
    if (active && active.page) active.page.destroy();
    active = null;
  }

  // ---------- The shell around the content ----------
  function markActive(section) {
    document.querySelectorAll('[data-nav-link]').forEach((link) => {
      const on = link.dataset.navLink === section;
      link.classList.toggle('is-active', on);
      if (on) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    document.dispatchEvent(
      new CustomEvent('nx:section', {detail: {section, area}}),
    );
  }

  function focusHeading(root) {
    const heading = root.querySelector('h1') || root;
    if (!heading.hasAttribute('tabindex'))
      heading.setAttribute('tabindex', '-1');
    heading.focus({preventScroll: true});
  }

  // The top of the content, just under anything sticky above it.
  function contentTop() {
    let offset = 0;
    document.querySelectorAll('[data-nav-sticky]').forEach((el) => {
      if (
        getComputedStyle(el).position === 'sticky' ||
        getComputedStyle(el).position === 'fixed'
      )
        offset = Math.max(offset, el.getBoundingClientRect().bottom);
    });
    return Math.max(
      0,
      main.getBoundingClientRect().top + window.scrollY - offset - 12,
    );
  }

  function rememberScroll() {
    const state =
      history.state && history.state.nxNav ? history.state : {nxNav: true};
    history.replaceState(
      {...state, scrollY: window.scrollY},
      '',
      location.href,
    );
  }

  // ---------- Loading a section ----------
  function fullLoad(url, mode) {
    if (mode === 'pop') window.location.reload();
    else window.location.assign(url);
  }

  function clearUnsaved() {
    main.querySelectorAll('[data-unsaved="true"]').forEach((form) => {
      delete form.dataset.unsaved;
    });
  }

  // mode: "push" (a click), "replace" (refresh the same section after a change), "pop" (Back/Forward).
  async function load(href, mode = 'push') {
    const url = new URL(href, location.href);
    if (
      main.querySelector('[data-pending="true"]') ||
      window.Nx.hasPendingAdminWrites?.()
    ) {
      window.Nx.toast('Please wait for the current save to finish.');
      if (mode === 'pop') history.pushState({}, '', shownUrl);
      return;
    }
    if (unsaved()) {
      if (askingToLeave) return;
      askingToLeave = true;
      let leave;
      try {
        leave = await window.Nx.confirm({
          title: 'Leave unsaved changes?',
          message: 'Your changes have not been saved.',
          confirmLabel: 'Discard changes',
        });
      } finally {
        askingToLeave = false;
      }
      if (!leave) {
        if (mode === 'pop') history.pushState({}, '', shownUrl);
        return;
      }
    }
    if (!inArea(url)) {
      clearUnsaved();
      fullLoad(url.href, mode);
      return;
    }
    if (request) request.abort();
    const controller = new AbortController();
    request = controller;
    const spinner = setTimeout(() => {
      if (request === controller) main.classList.add('is-loading');
    }, SPINNER_DELAY);
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 20000);
    main.setAttribute('aria-busy', 'true');
    try {
      const options = {
        headers: {'X-Partial': '1', Accept: 'text/html'},
        credentials: 'same-origin',
        cache: 'no-store',
        signal: controller.signal,
      };
      let response = await fetch(url.href, options);
      if (controller.signal.aborted || request !== controller) return;
      const login = area === 'admin' ? `${adminBase}/login` : '/login';
      // A normal access-token expiry must not tear down the editor or flash the sign-in page.
      if (
        (response.status === 401 ||
          new URL(response.url || url.href).pathname === login) &&
        window.Nx.renewSession &&
        (await window.Nx.renewSession())
      ) {
        if (controller.signal.aborted || request !== controller) return;
        response = await fetch(url.href, options);
      }
      if (controller.signal.aborted || request !== controller) return;
      if (response.status >= 500 || response.status === 429) {
        throw new Error('Section temporarily unavailable');
      }
      const finalUrl = new URL(response.url || url.href);
      const html = await response.text();
      if (controller.signal.aborted || request !== controller) return;
      const fresh = new DOMParser()
        .parseFromString(html, 'text/html')
        .querySelector('[data-page]');
      // Signed out, an error page, or a page that must load in full.
      if (
        !response.ok ||
        !fresh ||
        fresh.dataset.pageFull === '1' ||
        !inArea(finalUrl)
      ) {
        clearUnsaved();
        fullLoad(url.href, mode);
        return;
      }
      if (controller.signal.aborted) return;
      if (mode === 'push') rememberScroll();
      // A redirect (for example /wishlist answering as /account/lists) shows its final URL.
      if (!finalUrl.hash) finalUrl.hash = url.hash;
      swap(fresh, finalUrl.href, mode);
    } catch (error) {
      if (request !== controller || (error?.name === 'AbortError' && !timedOut))
        return;
      // A committed create must never leave an old create form available for duplicate submission.
      if (main.querySelector('[data-saved="true"]')) {
        clearUnsaved();
        fullLoad(url.href, mode);
        return;
      }
      if (mode === 'pop')
        history.pushState({nxNav: true, scrollY: window.scrollY}, '', shownUrl);
      window.Nx.toast(
        timedOut
          ? 'That page took too long. Your current page is still here; try again.'
          : "We couldn't open that page. Your current page and unsaved changes are still here; try again.",
        'error',
      );
    } finally {
      clearTimeout(spinner);
      clearTimeout(timeout);
      if (request === controller) {
        request = null;
        main.classList.remove('is-loading');
        main.removeAttribute('aria-busy');
      }
    }
  }

  function swap(fresh, href, mode) {
    const old = main.querySelector('[data-page]');
    stop();
    const root = document.importNode(fresh, true);
    const title = root.dataset.pageTitle;
    root.removeAttribute('data-page-title');
    old.replaceWith(root);
    if (title) document.title = title;

    if (mode === 'push') history.pushState({nxNav: true, scrollY: 0}, '', href);
    else if (mode === 'replace')
      history.replaceState({...(history.state || {}), nxNav: true}, '', href);
    shownUrl = keyOf(new URL(href, location.href));

    markActive(root.dataset.section);
    start(root);

    // Scroll: the top of the content for a new section; where it was for Back/Forward; unchanged
    // when the same section refreshes after a change.
    if (mode === 'push') {
      const hashTarget =
        location.hash && document.getElementById(safeHash(location.hash));
      if (hashTarget) hashTarget.scrollIntoView();
      else if (window.scrollY > contentTop()) window.scrollTo(0, contentTop());
    } else if (mode === 'pop') {
      const saved = history.state && Number(history.state.scrollY);
      window.scrollTo(0, Number.isFinite(saved) ? saved : 0);
    }
    focusHeading(root);
  }

  function safeHash(hash) {
    try {
      return decodeURIComponent(hash.slice(1));
    } catch {
      return hash.slice(1);
    }
  }

  // ---------- Links and GET forms ----------
  document.addEventListener('click', (event) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    const link =
      event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!link || link.closest('[data-nav-skip]')) return;
    if (link.target && link.target !== '_self') return;
    if (link.hasAttribute('download') || link.hasAttribute('data-full-load'))
      return;
    const url = new URL(link.href, location.href);
    if (!inArea(url)) return;
    // A link to a spot on this same section: the browser jumps there by itself.
    if (url.hash && keyOf(url) === shownUrl) return;
    event.preventDefault();
    load(url.href, 'push');
  });

  // Search and filter forms (method GET with an action) that point inside the area.
  document.addEventListener('submit', (event) => {
    const form = event.target;
    if (event.defaultPrevented || !(form instanceof HTMLFormElement)) return;
    // Read the attributes: a field named "method" or "action" would hide form.method / form.action.
    if (
      (form.getAttribute('method') || 'get').toLowerCase() !== 'get' ||
      !form.hasAttribute('action')
    )
      return;
    const url = new URL(form.getAttribute('action'), location.href);
    if (!inArea(url)) return;
    event.preventDefault();
    const params = new URLSearchParams();
    for (const [key, value] of new FormData(form))
      if (typeof value === 'string' && value !== '') params.append(key, value);
    url.search = params.toString();
    load(url.href, 'push');
  });

  // ---------- Back and Forward ----------
  window.addEventListener('popstate', () => {
    const here = new URL(location.href);
    if (keyOf(here) === shownUrl) return; // only the #hash changed
    load(here.href, 'pop');
  });

  // ---------- Used by section scripts after a change ----------
  window.NxNav = {
    go: (href) => load(href, 'push'),
    reload: () => load(location.href, 'replace'),
    inArea: (href) => inArea(new URL(href, location.href)),
  };

  // ---------- Start ----------
  history.scrollRestoration = 'manual';
  history.replaceState(
    {...(history.state || {}), nxNav: true, scrollY: window.scrollY},
    '',
    location.href,
  );
  window.addEventListener('pagehide', rememberScroll);
  // Deferred scripts have all run by now, so every section module is registered.
  document.addEventListener('DOMContentLoaded', () => {
    const root = main.querySelector('[data-page]');
    if (root) start(root);
  });
})();
