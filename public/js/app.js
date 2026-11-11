// Shared browser helpers for every page: API calls, toasts, form errors, menus, sign out.
(function () {
  "use strict";

  const Nx = (window.Nx = window.Nx || {});

  // ---------- Money ----------
  // The API sends money in paise (₹1 = 100 paise): 12345600 shows as "₹1,23,456".
  const wholeRupees = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
  const exactRupees = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // Sizes of a photo, the same rules as utils/images.js. Our own uploads are stored as ".../products/<id>-full.webp"
  // with smaller copies beside them (-200, -400, -800, -1600); Unsplash photos take a width in the address.
  const OWN_PHOTO = /^(.*\/products\/[a-f0-9]{32})-full\.webp$/;
  const UNSPLASH_PHOTO = /^https:\/\/images\.unsplash\.com\/[^?#]+\?/;
  const PHOTO_WIDTHS = [200, 400, 800, 1600];
  // The smallest copy that is at least this wide, or the photo itself.
  Nx.photoSized = function photoSized(url, width) {
    const own = OWN_PHOTO.exec(url || "");
    if (own) {
      const size = PHOTO_WIDTHS.find(candidate => candidate >= width);
      return size ? `${own[1]}-${size}.webp` : url;
    }
    if (UNSPLASH_PHOTO.test(url || "") && /([?&])w=\d+/.test(url)) return url.replace(/([?&])w=\d+/, `$1w=${width}`);
    return url;
  };
  // A srcset for a product card, or "" when the photo only comes in one size.
  Nx.photoSrcset = function photoSrcset(url) {
    const own = OWN_PHOTO.exec(url || "");
    if (own) return [400, 800, 1600].map(width => `${own[1]}-${width}.webp ${width}w`).join(", ");
    if (UNSPLASH_PHOTO.test(url || "") && /([?&])w=\d+/.test(url)) return [400, 600, 800].map(width => `${url.replace(/([?&])w=\d+/, `$1w=${width}`)} ${width}w`).join(", ");
    return "";
  };

  Nx.formatPrice = function formatPrice(paise) {
    const value = Math.round(Number(paise) || 0);
    return value % 100 === 0 ? wholeRupees.format(value / 100) : exactRupees.format(value / 100);
  };

  // Sign-in calls answer 401/403 for a wrong password; those must stay on the form.
  const LOGIN_CALLS = ["/api/login", "/api/signup", "/api/admin/login"];
  // The renewal endpoint. The refresh cookie's path is this exact URL, so the browser only sends
  // the long-lived token here. A 401 from this call means the session really is over.
  const REFRESH_URL = "/api/auth/refresh";

  // Admin pages carry their private base path on <body>; everything else is the store. The two
  // sessions have separate cookies, so the renewal has to say which one it means.
  const isAdminPage = () => Boolean(document.body.dataset.adminPath);

  // The login ended elsewhere (signed out in another tab, token expired, account blocked):
  // go to the right sign-in page and come back here afterwards.
  function sendToLogin(reason) {
    const here = window.location.pathname + window.location.search;
    const admin = document.body.dataset.adminPath;
    const loginPath = admin ? `${admin}/login` : "/login";
    const params = new URLSearchParams({ next: here, reason });
    window.location.replace(`${loginPath}?${params}`);
  }

  // One request. Returns { response, data } and never throws for an HTTP error status.
  async function send(url, { method = "GET", body } = {}) {
    // FormData (file uploads) sets its own multipart Content-Type; everything else is sent as JSON.
    const isForm = typeof FormData !== "undefined" && body instanceof FormData;
    const headers = { Accept: "application/json" };
    if (body !== undefined && !isForm) headers["Content-Type"] = "application/json";

    let response;
    try {
      response = await fetch(url, {
        method,
        headers,
        credentials: "same-origin",
        body: body === undefined || isForm ? body : JSON.stringify(body)
      });
    } catch {
      const offline = new Error("We couldn't reach Nexthlon. Check your connection and try again.");
      offline.status = 0;
      throw offline;
    }

    let data = {};
    try {
      data = await response.json();
    } catch {
      data = {};
    }
    return { response, data };
  }

  // Asks the server for a new access token using the refresh cookie. Several calls can get a 401
  // at the same moment, so they all wait on ONE renewal: rotation would revoke the token of any
  // second call and, worse, look like a stolen token.
  let renewal = null;
  function renewSession() {
    if (!renewal) {
      renewal = send(REFRESH_URL, { method: "POST", body: { scope: isAdminPage() ? "admin" : "customer" } })
        .then(({ response }) => response.ok)
        .catch(() => false)
        .finally(() => { renewal = null; });
    }
    return renewal;
  }
  Nx.renewSession = renewSession;

  // Calls our JSON API. The cookies are sent automatically; no token is ever readable here.
  // On a 401 the access token has simply run out (15 minutes), so this renews the session once
  // and sends the very same request again. Only if the renewal fails does the visitor go to sign in.
  Nx.api = async function api(url, options = {}) {
    const path = new URL(url, window.location.href).pathname;
    const canRenew = !LOGIN_CALLS.includes(path) && path !== REFRESH_URL;

    let { response, data } = await send(url, options);
    if (response.status === 401 && canRenew && await renewSession()) {
      ({ response, data } = await send(url, options));
    }

    if (!response.ok) {
      const blocked = response.status === 403 && /account has been blocked/i.test(data.message || "");
      if ((response.status === 401 || blocked) && canRenew) {
        sendToLogin(blocked ? "blocked" : "expired");
      }
      const error = new Error(data.message || "Something went wrong. Please try again.");
      error.status = response.status;
      error.fieldErrors = data.errors || {};
      // Lets a form read rate-limit headers (attempts left) on a failed request.
      error.headers = response.headers;
      throw error;
    }
    return data;
  };

  // ---------- Toasts ----------
  function iconSvg(name) {
    return `<svg class="i" aria-hidden="true"><use href="/img/icons.svg#${name}"></use></svg>`;
  }

  Nx.toast = function toast(message, type = "success") {
    const box = document.getElementById("toasts");
    if (!box) return;
    const item = document.createElement("div");
    item.className = `toast toast-${type}`;
    // The #toasts box is already a polite live region, so a normal message is read out from there.
    // An error interrupts (role="alert"). Giving success messages role="status" as well made some
    // screen readers say them twice.
    if (type === "error") item.setAttribute("role", "alert");
    item.innerHTML = `<span class="toast-icon">${iconSvg(type === "error" ? "alert" : "check")}</span>`;
    const text = document.createElement("span");
    text.className = "toast-text";
    text.textContent = message;
    const close = document.createElement("button");
    close.type = "button";
    close.className = "toast-close";
    close.setAttribute("aria-label", "Dismiss message");
    close.innerHTML = iconSvg("x");
    const timer = document.createElement("span");
    timer.className = "toast-timer";
    item.append(text, close, timer);
    box.append(item);

    let removed = false;
    const remove = () => {
      if (removed) return;
      removed = true;
      item.classList.add("is-leaving");
      setTimeout(() => item.remove(), 250);
    };
    close.addEventListener("click", remove);
    // The message closes itself after a while, but never while the pointer is on it or focus is
    // inside it (the close button): the countdown pauses and starts again from where it was.
    let left = type === "error" ? 6500 : 4500;
    let startedAt = 0;
    let timeout = 0;
    const run = () => {
      startedAt = Date.now();
      timeout = setTimeout(remove, left);
      item.classList.remove("is-paused");
    };
    const pause = () => {
      if (!timeout) return;
      clearTimeout(timeout);
      timeout = 0;
      left = Math.max(1200, left - (Date.now() - startedAt));
      item.classList.add("is-paused");
    };
    const resume = () => {
      if (!timeout && !item.matches(":hover, :focus-within")) run();
    };
    item.addEventListener("pointerenter", pause);
    item.addEventListener("pointerleave", resume);
    item.addEventListener("focusin", pause);
    item.addEventListener("focusout", () => setTimeout(resume, 0));
    run();
  };

  // A message that survives a page reload, shown on the next page.
  Nx.flash = function flash(message, type = "success") {
    try {
      sessionStorage.setItem("nx-flash", JSON.stringify({ message, type }));
    } catch {
      /* storage blocked: the message is simply skipped */
    }
  };

  function showFlash() {
    try {
      const saved = sessionStorage.getItem("nx-flash");
      if (!saved) return;
      sessionStorage.removeItem("nx-flash");
      const { message, type } = JSON.parse(saved);
      Nx.toast(message, type);
    } catch {
      /* ignore broken or blocked storage */
    }
  }

  // ---------- Forms ----------
  Nx.formValues = function formValues(form) {
    const values = {};
    for (const element of form.elements) {
      if (!element.name || element.disabled) continue;
      if (element.type === "checkbox") values[element.name] = element.checked;
      else if (element.type === "radio") { if (element.checked) values[element.name] = element.value; }
      else if (element.type !== "submit" && element.type !== "button") values[element.name] = element.value;
    }
    return values;
  };

  Nx.clearErrors = function clearErrors(form) {
    form.querySelectorAll("[data-error-for]").forEach(el => { el.textContent = ""; });
    form.querySelectorAll("[aria-invalid]").forEach(el => el.removeAttribute("aria-invalid"));
    Nx.formAlert(form, "");
  };

  // Shows a message box at the top of a form. Returns false when the form has no message box.
  Nx.formAlert = function formAlert(form, message, type = "error") {
    const slot = form.querySelector("[data-form-alert]");
    if (!slot) return false;
    slot.className = `form-alert form-alert-${type}${slot.classList.contains("field-wide") ? " field-wide" : ""}`;
    slot.innerHTML = message ? iconSvg(type === "error" ? "alert" : "check") : "";
    if (message) {
      const text = document.createElement("span");
      text.textContent = message;
      slot.append(text);
    }
    return true;
  };

  Nx.showErrors = function showErrors(form, errors = {}) {
    let first = null;
    for (const [name, message] of Object.entries(errors)) {
      const slot = form.querySelector(`[data-error-for="${name}"]`);
      const input = form.querySelector(`[name="${name}"]`);
      if (slot) slot.textContent = message;
      if (input) {
        input.setAttribute("aria-invalid", "true");
        if (!first) first = input;
      }
    }
    if (first) first.focus();
  };

  // Swaps a button for a spinner and a short label while a request runs, then puts it back.
  const savedLabels = new WeakMap();
  Nx.busy = function busy(button, isBusy, busyLabel = "Please wait…") {
    if (!button) return;
    if (isBusy) {
      if (!savedLabels.has(button)) savedLabels.set(button, button.innerHTML);
      button.innerHTML = '<span class="spinner" aria-hidden="true"></span>';
      const label = document.createElement("span");
      label.textContent = busyLabel;
      button.append(label);
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
    } else {
      if (savedLabels.has(button)) button.innerHTML = savedLabels.get(button);
      savedLabels.delete(button);
      button.disabled = false;
      button.removeAttribute("aria-busy");
    }
  };

  // Submits a form to the API, showing field errors and a busy button. Returns the reply or null.
  Nx.submitForm = async function submitForm(form, { url, method = "POST", body, busyLabel }) {
    const button = form.querySelector('[type="submit"]');
    Nx.clearErrors(form);
    Nx.busy(button, true, busyLabel);
    try {
      return await Nx.api(url, { method, body: body || Nx.formValues(form) });
    } catch (error) {
      Nx.showErrors(form, error.fieldErrors);
      // Forms with a message box show the error there; others fall back to a toast.
      if (!Nx.formAlert(form, error.message, "error")) Nx.toast(error.message, "error");
      return null;
    } finally {
      Nx.busy(button, false);
    }
  };

  // ---------- Header cart count ----------
  // Updates the badge on the header cart icon after any cart change, without reloading.
  Nx.setCartCount = function setCartCount(count) {
    const total = Math.max(0, Number(count) || 0);
    document.querySelectorAll("[data-cart-count]").forEach(badge => {
      badge.textContent = String(total);
      badge.hidden = total === 0;
      badge.classList.remove("is-bumped");
      // Restart the little bump animation (the class is styled in style.css).
      void badge.offsetWidth;
      badge.classList.add("is-bumped");
    });
    document.querySelectorAll("[data-cart-link]").forEach(link => {
      link.setAttribute("aria-label", `Cart, ${total} ${total === 1 ? "item" : "items"}`);
    });
  };

  // ---------- Confirm dialog ----------
  // tone "danger" (red button) for destructive actions, "primary" (blue) for safe ones.
  Nx.confirm = function confirmDialog({ title, message, confirmLabel = "Confirm", tone = "danger" }) {
    const dialog = document.getElementById("confirm-dialog");
    if (!dialog || typeof dialog.showModal !== "function") return Promise.resolve(false);
    dialog.querySelector("#confirm-title").textContent = title;
    dialog.querySelector("#confirm-message").textContent = message;
    const ok = dialog.querySelector("#confirm-ok");
    ok.textContent = confirmLabel;
    ok.className = `btn ${tone === "danger" ? "btn-danger" : "btn-primary"}`;
    dialog.dataset.tone = tone;
    const icon = dialog.querySelector("[data-confirm-icon]");
    if (icon) icon.innerHTML = iconSvg(tone === "danger" ? "alert" : "check");
    dialog.returnValue = "";
    dialog.showModal();
    // The safe choice gets focus first, so Enter never confirms a destructive action by accident.
    if (tone === "danger") dialog.querySelector('[value="cancel"]').focus();
    return new Promise(resolve => {
      dialog.addEventListener("close", () => resolve(dialog.returnValue === "ok"), { once: true });
    });
  };

  // ---------- Dialogs: modals, side drawers and bottom sheets ----------
  // [data-dialog-open="id"] opens <dialog id="id">; [data-dialog-close] inside one closes it.
  // Clicking the dimmed backdrop also closes it. The browser keeps focus inside and handles Escape.
  document.addEventListener("click", event => {
    const opener = event.target.closest("[data-dialog-open]");
    if (opener) {
      const dialog = document.getElementById(opener.dataset.dialogOpen);
      if (dialog && typeof dialog.showModal === "function" && !dialog.open) dialog.showModal();
      return;
    }
    const closer = event.target.closest("dialog [data-dialog-close]");
    if (closer) {
      closer.closest("dialog").close();
      return;
    }
    if (event.target instanceof HTMLDialogElement && event.target.open && !event.target.classList.contains("confirm-dialog")) {
      const box = event.target.getBoundingClientRect();
      const outside = event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom;
      if (outside) event.target.close();
    }
  });

  // ---------- Account menu ----------
  function setupMenus() {
    document.querySelectorAll("[data-menu]").forEach(menu => {
      const toggle = menu.querySelector("[data-menu-toggle]");
      const panel = menu.querySelector("[data-menu-panel]");
      if (!toggle || !panel) return;
      const items = () => [...panel.querySelectorAll("a, button")];
      const close = () => {
        panel.hidden = true;
        toggle.setAttribute("aria-expanded", "false");
      };
      toggle.addEventListener("click", event => {
        event.stopPropagation();
        const opening = panel.hidden;
        panel.hidden = !opening;
        toggle.setAttribute("aria-expanded", String(opening));
      });
      // Arrow keys move through the menu; opening with the keyboard focuses the first link.
      toggle.addEventListener("keydown", event => {
        if (event.key !== "ArrowDown") return;
        event.preventDefault();
        panel.hidden = false;
        toggle.setAttribute("aria-expanded", "true");
        items()[0].focus();
      });
      panel.addEventListener("keydown", event => {
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        event.preventDefault();
        const list = items();
        const step = event.key === "ArrowDown" ? 1 : -1;
        list[(list.indexOf(document.activeElement) + step + list.length) % list.length].focus();
      });
      menu.addEventListener("focusout", event => {
        if (!menu.contains(event.relatedTarget)) close();
      });
      document.addEventListener("click", event => {
        if (!menu.contains(event.target)) close();
      });
      document.addEventListener("keydown", event => {
        if (event.key === "Escape" && !panel.hidden) {
          close();
          toggle.focus();
        }
      });
    });
  }

  // ---------- Header ----------
  // Sticky toolbars sit just under the header, so they need its real height.
  function setupHeader() {
    const header = document.querySelector("[data-site-header]");
    if (!header) return;
    // --header-h is how much of the screen the header covers, so other sticky bars sit below it.
    // On phones it tucks away while you scroll down (it then covers nothing) and comes back as soon
    // as you scroll up, like a shop app; mobile.css slides it.
    let tucked = false;
    const update = () => {
      const sticky = getComputedStyle(header).position === "sticky";
      document.documentElement.style.setProperty("--header-h", `${sticky && !tucked ? header.offsetHeight : 0}px`);
    };
    update();
    if ("ResizeObserver" in window) new ResizeObserver(update).observe(header);

    const phone = window.matchMedia("(max-width: 720px)");
    const setTucked = on => {
      if (on === tucked) return;
      tucked = on;
      header.classList.toggle("is-tucked", on);
      update();
    };
    let lastY = window.scrollY;
    // Cheap enough to run on every scroll event (a few numbers and at most one class change).
    const onScroll = () => {
      const y = window.scrollY;
      const dy = y - lastY;
      // Never hide while the menu is open or something in the header (the search box) is in use.
      const busy = document.body.classList.contains("drawer-open") || header.contains(document.activeElement);
      if (!phone.matches || busy || y < header.offsetHeight) setTucked(false);
      else if (dy > 6) setTucked(true);
      else if (dy < -6) setTucked(false);
      if (Math.abs(dy) > 6 || y < header.offsetHeight) lastY = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    phone.addEventListener("change", () => setTucked(false));

    // On phones the category bar scrolls sideways; bring the current category into view.
    const bar = document.querySelector("[data-catnav]");
    const active = bar && bar.querySelector(".is-active");
    if (active && bar.scrollWidth > bar.clientWidth) {
      bar.scrollLeft = active.offsetLeft - (bar.clientWidth - active.offsetWidth) / 2;
    }
  }

  // ---------- Sign out ----------
  function setupLogout() {
    document.querySelectorAll("[data-logout]").forEach(button => {
      button.addEventListener("click", async () => {
        button.disabled = true;
        const endpoint = button.dataset.logout || "/api/logout";
        try {
          await Nx.api(endpoint, { method: "POST" });
          Nx.flash("You have been signed out.");
          // replace, not assign: the signed-in page is dropped from history, so Back cannot return to it.
          const admin = document.body.dataset.adminPath;
          window.location.replace(endpoint === "/api/admin/logout" && admin ? `${admin}/login` : "/");
        } catch (error) {
          button.disabled = false;
          Nx.toast(error.message, "error");
        }
      });
    });
  }

  // ---------- Show/hide password ----------
  // One delegated listener, so buttons in content swapped in later (My Account) work too.
  function setupReveal() {
    document.addEventListener("click", event => {
      const button = event.target instanceof Element ? event.target.closest("button[data-reveal]") : null;
      const input = button && document.getElementById(button.dataset.reveal);
      if (!input) return;
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      button.setAttribute("aria-label", show ? "Hide password" : "Show password");
      button.innerHTML = iconSvg(show ? "eye-off" : "eye");
    });
  }

  // A field's error message disappears as soon as the user starts fixing it.
  document.addEventListener("input", event => {
    const field = event.target;
    if (!field.name || field.getAttribute("aria-invalid") !== "true") return;
    field.removeAttribute("aria-invalid");
    const slot = field.form && field.form.querySelector(`[data-error-for="${field.name}"]`);
    if (slot) slot.textContent = "";
  });

  // Back/Forward can restore a page straight from memory without asking the server.
  // Reload it so the server checks the login again and redirects a signed-out visitor.
  window.addEventListener("pageshow", event => {
    if (event.persisted) window.location.reload();
  });

  // ---------- Coming back from an expired page load ----------
  // Nx.api renews quietly, but a plain page load cannot: the refresh cookie is only sent to
  // /api/auth/refresh, so the server had to bounce us here. Try the renewal once and, if it
  // works, carry straight on to the page that was wanted. The flag stops this ever looping.
  const RENEW_TRIED = "nx-renew-tried";
  function renewAfterBounce() {
    const params = new URLSearchParams(window.location.search);
    const expired = Boolean(document.querySelector("[data-auth]")) && params.get("reason") === "expired";
    let tried = false;
    try {
      tried = sessionStorage.getItem(RENEW_TRIED) === "1";
      if (expired) sessionStorage.setItem(RENEW_TRIED, "1");
      else sessionStorage.removeItem(RENEW_TRIED);
    } catch {
      /* storage blocked: fall back to showing the sign-in form */
    }
    if (!expired || tried) return;
    // Only a path on this site, never another website.
    const next = params.get("next") || "/";
    const target = next.startsWith("/") && !next.startsWith("//") ? next : "/";
    renewSession().then(ok => { if (ok) window.location.replace(target); });
  }

  // ---------- Footer link groups ----------
  // On phones each group (Shop, Help, ...) starts closed and opens with a tap, which keeps the footer
  // short. On wider screens they are always open. Without this script they are simply all open.
  function setupFooterGroups() {
    const groups = [...document.querySelectorAll("[data-footer-col]")];
    if (!groups.length) return;
    const phone = window.matchMedia("(max-width: 720px)");
    const fit = () => groups.forEach(group => { group.open = !phone.matches; });
    fit();
    phone.addEventListener("change", fit);
  }

  setupMenus();
  setupHeader();
  setupLogout();
  setupReveal();
  setupFooterGroups();
  showFlash();
  renewAfterBounce();
})();
