// Shared browser helpers for every page: API calls, toasts, form errors, menus, sign out.
(function () {
  "use strict";

  const Nx = (window.Nx = {});

  // Calls our JSON API. The login cookie is sent automatically; the token is never readable here.
  Nx.api = async function api(url, options = {}) {
    const { method = "GET", body } = options;
    const headers = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";

    let response;
    try {
      response = await fetch(url, {
        method,
        headers,
        credentials: "same-origin",
        body: body === undefined ? undefined : JSON.stringify(body)
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
    if (!response.ok) {
      const error = new Error(data.message || "Something went wrong. Please try again.");
      error.status = response.status;
      error.fieldErrors = data.errors || {};
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
    item.setAttribute("role", type === "error" ? "alert" : "status");
    item.innerHTML = iconSvg(type === "error" ? "alert" : "check");
    const text = document.createElement("span");
    text.textContent = message;
    item.append(text);
    box.append(item);
    setTimeout(() => {
      item.classList.add("is-leaving");
      setTimeout(() => item.remove(), 300);
    }, 4200);
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
      else if (element.type !== "submit" && element.type !== "button") values[element.name] = element.value;
    }
    return values;
  };

  Nx.clearErrors = function clearErrors(form) {
    form.querySelectorAll("[data-error-for]").forEach(el => { el.textContent = ""; });
    form.querySelectorAll("[aria-invalid]").forEach(el => el.removeAttribute("aria-invalid"));
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

  Nx.busy = function busy(button, isBusy, busyLabel = "Please wait…") {
    if (!button) return;
    if (isBusy) {
      button.dataset.label = button.textContent;
      button.textContent = busyLabel;
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
    } else {
      button.textContent = button.dataset.label || button.textContent;
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
      Nx.toast(error.message, "error");
      return null;
    } finally {
      Nx.busy(button, false);
    }
  };

  // ---------- Confirm dialog ----------
  Nx.confirm = function confirmDialog({ title, message, confirmLabel = "Confirm" }) {
    const dialog = document.getElementById("confirm-dialog");
    if (!dialog || typeof dialog.showModal !== "function") return Promise.resolve(false);
    dialog.querySelector("#confirm-title").textContent = title;
    dialog.querySelector("#confirm-message").textContent = message;
    dialog.querySelector("#confirm-ok").textContent = confirmLabel;
    dialog.returnValue = "";
    dialog.showModal();
    return new Promise(resolve => {
      dialog.addEventListener("close", () => resolve(dialog.returnValue === "ok"), { once: true });
    });
  };

  // ---------- Account menu ----------
  function setupMenus() {
    document.querySelectorAll("[data-menu]").forEach(menu => {
      const toggle = menu.querySelector("[data-menu-toggle]");
      const panel = menu.querySelector("[data-menu-panel]");
      if (!toggle || !panel) return;
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

  // ---------- Sign out ----------
  function setupLogout() {
    document.querySelectorAll("[data-logout]").forEach(button => {
      button.addEventListener("click", async () => {
        button.disabled = true;
        try {
          await Nx.api(button.dataset.logout || "/api/logout", { method: "POST" });
          Nx.flash("You have been signed out.");
          window.location.assign("/");
        } catch (error) {
          button.disabled = false;
          Nx.toast(error.message, "error");
        }
      });
    });
  }

  // ---------- Show/hide password ----------
  function setupReveal() {
    document.querySelectorAll("[data-reveal]").forEach(button => {
      const input = document.getElementById(button.dataset.reveal);
      if (!input) return;
      button.addEventListener("click", () => {
        const show = input.type === "password";
        input.type = show ? "text" : "password";
        button.setAttribute("aria-label", show ? "Hide password" : "Show password");
        button.innerHTML = iconSvg(show ? "eye-off" : "eye");
      });
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

  setupMenus();
  setupLogout();
  setupReveal();
  showFlash();
})();
