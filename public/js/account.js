// My Account: the script for every account section. Calm on purpose: no tilt, count-ups, flips,
// confetti or other movement, just clear actions with toasts.
//
// Each section is a module in window.NxPages ("account-wallet", "account-lists", ...) with
// init(root) and destroy(). Its listeners are attached to the section's root element with an
// AbortSignal, so destroy() removes every one of them in one go: no duplicates, no leaks, even
// after the section is swapped many times. A few actions shared by every section (copy a code,
// add to cart, share an invite) use one delegated listener on the document, attached once.
(function () {
  "use strict";

  const Pages = (window.NxPages = window.NxPages || {});

  // define(name, setup): setup(root, signal) attaches the section's listeners and may return a
  // cleanup function for anything else (timers, elements outside the root).
  function define(name, setup) {
    let controller = null;
    let cleanup = null;
    Pages[name] = {
      init(root) {
        this.destroy();
        controller = new AbortController();
        const result = setup(root, controller.signal);
        cleanup = typeof result === "function" ? result : null;
      },
      destroy() {
        if (controller) controller.abort();
        if (cleanup) cleanup();
        controller = null;
        cleanup = null;
      }
    };
  }

  // A delegated listener on a section root: handler(event, matchedElement).
  function on(root, type, selector, handler, signal) {
    root.addEventListener(type, event => {
      const target = event.target instanceof Element ? event.target.closest(selector) : null;
      if (target && root.contains(target)) handler(event, target);
    }, { signal });
  }

  // After a change, show the section again with fresh data. The no-reload router (account-nav.js)
  // swaps just the content; without it the page reloads and the message shows after.
  function refresh(message, type = "success") {
    if (window.NxAccountNav && window.NxAccountNav.reload) {
      window.NxAccountNav.reload().then(() => message && Nx.toast(message, type));
      return;
    }
    if (message) Nx.flash(message, type);
    window.location.reload();
  }

  function go(url, message) {
    if (window.NxAccountNav && window.NxAccountNav.go) {
      window.NxAccountNav.go(url).then(() => message && Nx.toast(message));
      return;
    }
    if (message) Nx.flash(message);
    window.location.assign(url);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // http:// without a secure context, or an older browser: a hidden field and the copy command.
      const field = document.createElement("textarea");
      field.value = text;
      field.setAttribute("readonly", "");
      field.className = "sr-only";
      document.body.append(field);
      field.select();
      const done = document.execCommand && document.execCommand("copy");
      field.remove();
      return Boolean(done);
    }
  }

  // ---------- Shared actions (one delegated listener for the whole page) ----------
  document.addEventListener("click", async event => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    // Copy a coupon code, a referral code or an invite link.
    const copy = target.closest("[data-copy-code]");
    if (copy) {
      const text = copy.dataset.copyCode;
      if (await copyText(text)) Nx.toast(`${copy.dataset.copyLabel || "Code"} copied: ${text}`);
      else Nx.toast("Copying didn't work. Select the code and copy it instead.", "error");
      return;
    }

    // Share an invite: the phone's share sheet, or copy the link.
    const share = target.closest("[data-referral-share]");
    if (share) {
      const data = { title: "Join me on Nexthlon", text: `Use my code ${share.dataset.code} when you sign up on Nexthlon.`, url: share.dataset.link };
      if (navigator.share) {
        try {
          await navigator.share(data);
        } catch {
          /* the share sheet was closed */
        }
      } else if (await copyText(share.dataset.link)) {
        Nx.toast("Invite link copied. Paste it anywhere to share.");
      } else {
        Nx.toast("Could not copy the link.", "error");
      }
      return;
    }

    // Add to cart ("Buy it again" and delivered items on an order).
    const quick = target.closest("[data-quick-cart]");
    if (quick && !quick.disabled) {
      Nx.busy(quick, true, "Adding…");
      try {
        const result = await Nx.api("/api/cart/items", { method: "POST", body: { productId: quick.dataset.quickCart, quantity: 1 } });
        Nx.setCartCount(result.cart.summary.count);
        Nx.toast(result.message);
      } catch (error) {
        Nx.toast(error.message, "error");
      } finally {
        Nx.busy(quick, false);
      }
    }
  });

  // ---------- A small text prompt (rename a list), built on <dialog> ----------
  function askText({ title, label, value = "", confirmLabel = "Save", maxLength = 40 }) {
    const dialog = document.createElement("dialog");
    dialog.className = "modal acct-ask";
    dialog.innerHTML = '<form method="dialog" class="form"><div class="modal-head"><h2></h2></div><div class="modal-body"><div class="field"><label for="acct-ask-input"></label><input id="acct-ask-input" name="value" required></div></div><div class="modal-foot"><button class="btn btn-ghost" value="cancel" formnovalidate>Cancel</button><button class="btn btn-primary" value="ok"></button></div></form>';
    dialog.querySelector("h2").textContent = title;
    dialog.querySelector("label").textContent = label;
    const input = dialog.querySelector("input");
    input.value = value;
    input.maxLength = maxLength;
    dialog.querySelector('[value="ok"]').textContent = confirmLabel;
    document.body.append(dialog);
    dialog.showModal();
    input.select();
    return new Promise(resolve => {
      dialog.addEventListener("close", () => {
        resolve(dialog.returnValue === "ok" ? input.value.trim() : null);
        dialog.remove();
      }, { once: true });
    });
  }

  // A plain "done" card, then another page (used when the visitor is signed out).
  function doneThen(message, href) {
    const dialog = document.createElement("dialog");
    dialog.className = "modal acct-success";
    dialog.innerHTML = '<div class="modal-body"><span class="acct-done"><svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span><p role="status"></p></div>';
    dialog.querySelector("p").textContent = message;
    document.body.append(dialog);
    dialog.showModal();
    setTimeout(() => window.location.replace(href), 1200);
  }

  async function apiThen(call, message) {
    try {
      const reply = await call();
      refresh(message || reply.message);
      return reply;
    } catch (error) {
      Nx.toast(error.message, "error");
      return null;
    }
  }

  // ---------- Sections without their own actions ----------
  ["account-overview", "account-buy-again", "account-coupons", "account-wallet", "account-referral"].forEach(name => define(name, () => {}));

  // ---------- Your orders: the time filter applies as soon as it changes ----------
  define("account-orders", (root, signal) => {
    on(root, "change", "[data-orders-filter] select", (event, select) => select.form.requestSubmit(), signal);
  });

  // ---------- One order: cancel the order or an item, ask for a return ----------
  define("account-order", (root, signal) => {
    const page = root.querySelector("[data-order]");
    if (!page) return;
    const orderId = encodeURIComponent(page.dataset.orderId);
    const cancelDialog = root.querySelector("#cancel-dialog");
    const cancelForm = cancelDialog && cancelDialog.querySelector("[data-cancel-form]");
    const returnDialog = root.querySelector("#return-dialog");
    const returnForm = returnDialog && returnDialog.querySelector("[data-return-form]");

    on(root, "click", '[data-open-dialog="cancel-dialog"]', (event, button) => {
      const item = button.dataset.cancelScope === "item";
      cancelForm.reset();
      Nx.clearErrors(cancelForm);
      cancelForm.elements.itemId.value = item ? button.dataset.itemId : "";
      cancelDialog.querySelector("[data-cancel-title]").textContent = item ? `Cancel ${button.dataset.itemName}?` : "Cancel this order?";
      cancelDialog.querySelector("[data-cancel-text]").textContent = page.dataset.paid === "true"
        ? "The money for this goes back to you, and the item goes back on the shelf."
        : "The items go back on the shelf and you will not be charged for them.";
      cancelDialog.showModal();
    }, signal);

    on(root, "click", '[data-open-dialog="return-dialog"]', () => {
      returnForm.reset();
      Nx.clearErrors(returnForm);
      returnDialog.showModal();
    }, signal);

    on(root, "submit", "[data-cancel-form]", async event => {
      event.preventDefault();
      const values = Nx.formValues(cancelForm);
      const url = values.itemId
        ? `/api/orders/${orderId}/items/${encodeURIComponent(values.itemId)}/cancel`
        : `/api/orders/${orderId}/cancel`;
      const reply = await Nx.submitForm(cancelForm, { url, body: { reason: values.reason, refundMethod: values.refundMethod || "wallet" }, busyLabel: "Cancelling…" });
      if (reply) {
        cancelDialog.close();
        refresh(reply.message);
      }
    }, signal);

    on(root, "submit", "[data-return-form]", async event => {
      event.preventDefault();
      // With photos the form goes as multipart; without, as plain JSON.
      const photos = returnForm.querySelector("[data-return-photos]");
      if (photos && photos.files.length > 3) {
        Nx.showErrors(returnForm, { photos: "You can add up to 3 photos." });
        return;
      }
      const body = photos && photos.files.length ? new FormData(returnForm) : undefined;
      const reply = await Nx.submitForm(returnForm, { url: `/api/orders/${orderId}/return`, body, busyLabel: "Sending…" });
      if (reply) {
        returnDialog.close();
        refresh(reply.message);
      }
    }, signal);

    // Dialogs live inside the section; close them if the section goes away while one is open.
    return () => root.querySelectorAll("dialog[open]").forEach(dialog => dialog.close());
  });

  // ---------- Wishlist & lists ----------
  define("account-lists", (root, signal) => {
    const shell = document.querySelector("[data-acct]");
    const move = (productId, from, to) => apiThen(() => Nx.api("/api/lists/move", { method: "POST", body: { productId, from, to } }));

    on(root, "submit", "[data-list-create]", async (event, form) => {
      event.preventDefault();
      const reply = await Nx.submitForm(form, { url: "/api/lists", busyLabel: "Creating…" });
      if (reply) refresh(reply.message);
    }, signal);

    on(root, "click", "[data-list-rename]", async (event, button) => {
      const name = await askText({ title: "Rename list", label: "List name", value: button.dataset.name });
      if (name && name !== button.dataset.name) apiThen(() => Nx.api(`/api/lists/${button.dataset.listRename}`, { method: "PATCH", body: { name } }));
    }, signal);

    on(root, "click", "[data-list-delete]", async (event, button) => {
      const ok = await Nx.confirm({ title: `Delete "${button.dataset.name}"?`, message: "The list and its saved items will be removed. The products themselves stay in the store.", confirmLabel: "Delete list" });
      if (ok) apiThen(() => Nx.api(`/api/lists/${button.dataset.listDelete}`, { method: "DELETE" }));
    }, signal);

    on(root, "click", "[data-list-remove]", (event, button) => {
      const block = button.closest("[data-list]");
      button.disabled = true;
      apiThen(() => Nx.api(`/api/lists/${block.dataset.list}/items/${button.dataset.listRemove}`, { method: "DELETE" })).then(reply => {
        if (!reply) button.disabled = false;
      });
    }, signal);

    on(root, "click", "[data-list-cart]", async (event, button) => {
      const block = button.closest("[data-list]");
      Nx.busy(button, true, "Moving…");
      try {
        const reply = await Nx.api(`/api/lists/${block.dataset.list}/items/${button.dataset.listCart}/move-to-cart`, { method: "POST" });
        if (reply.cart && reply.cart.summary) Nx.setCartCount(reply.cart.summary.count);
        refresh(reply.message);
      } catch (error) {
        Nx.busy(button, false);
        Nx.toast(error.message, "error");
      }
    }, signal);

    on(root, "click", "[data-share-copy]", async (event, button) => {
      const url = new URL(button.dataset.shareCopy, window.location.origin).href;
      if (await copyText(url)) Nx.toast("Share link copied.");
      else Nx.toast("Could not copy the link.", "error");
    }, signal);

    on(root, "change", "[data-list-share]", (event, input) => {
      input.disabled = true;
      apiThen(() => Nx.api(`/api/lists/${input.dataset.listShare}/share`, { method: "PATCH", body: { enabled: input.checked } })).then(reply => {
        if (!reply) {
          input.checked = !input.checked;
          input.disabled = false;
        }
      });
    }, signal);

    // The keyboard (and touch) way to move an item: the "Move to…" menu on every card.
    on(root, "change", "[data-list-move]", (event, select) => {
      if (!select.value) return;
      select.disabled = true;
      move(select.dataset.listMove, select.closest("[data-list]").dataset.list, select.value).then(reply => {
        if (!reply) {
          select.value = "";
          select.disabled = false;
        }
      });
    }, signal);

    // Drag and drop (mouse): drag a card onto one of the list chips shown at the top while dragging.
    let dragged = null;
    const stopDrag = () => {
      if (dragged) dragged.classList.remove("is-dragged");
      if (shell) shell.classList.remove("is-dragging");
      root.querySelectorAll(".list-target.is-over").forEach(target => target.classList.remove("is-over"));
      dragged = null;
    };
    const canDrop = target => dragged && target.dataset.dropList !== dragged.dataset.from;
    on(root, "dragstart", "[data-list-item]", (event, card) => {
      dragged = card;
      card.classList.add("is-dragged");
      if (shell) shell.classList.add("is-dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", card.dataset.listItem);
    }, signal);
    on(root, "dragend", "[data-list-item]", stopDrag, signal);
    on(root, "dragover", "[data-drop-list]", (event, target) => {
      if (!canDrop(target)) return;
      event.preventDefault();
      target.classList.add("is-over");
    }, signal);
    on(root, "dragleave", "[data-drop-list]", (event, target) => target.classList.remove("is-over"), signal);
    on(root, "drop", "[data-drop-list]", (event, target) => {
      event.preventDefault();
      if (!canDrop(target)) return stopDrag();
      const card = dragged;
      stopDrag();
      move(card.dataset.listItem, card.dataset.from, target.dataset.dropList);
    }, signal);

    return stopDrag;
  });

  // ---------- Your reviews: edit in place, or delete ----------
  define("account-reviews", (root, signal) => {
    const parts = el => {
      const card = el.closest("[data-review]");
      return { card, id: card.dataset.review, view: card.querySelector("[data-review-view]"), form: card.querySelector("[data-review-form]") };
    };
    on(root, "click", "[data-review-edit]", (event, button) => {
      const { view, form } = parts(button);
      view.hidden = true;
      form.hidden = false;
      form.querySelector("textarea").focus();
    }, signal);
    on(root, "click", "[data-review-cancel]", (event, button) => {
      const { view, form } = parts(button);
      form.hidden = true;
      view.hidden = false;
      view.querySelector("[data-review-edit]").focus();
    }, signal);
    on(root, "submit", "[data-review-form]", async (event, form) => {
      event.preventDefault();
      const { id } = parts(form);
      const values = Nx.formValues(form);
      const body = { rating: Number(values.rating), title: values.title, body: values.body };
      const reply = await Nx.submitForm(form, { url: `/api/account/reviews/${id}`, method: "PATCH", body, busyLabel: "Saving…" });
      if (reply) refresh(reply.message);
    }, signal);
    on(root, "click", "[data-review-delete]", async (event, button) => {
      const { id } = parts(button);
      const ok = await Nx.confirm({ title: "Delete this review?", message: "It will be removed from the product page. You can write a new one later.", confirmLabel: "Delete review" });
      if (ok) apiThen(() => Nx.api(`/api/account/reviews/${id}`, { method: "DELETE" }));
    }, signal);
  });

  // ---------- Recently viewed ----------
  define("account-recent", (root, signal) => {
    on(root, "click", "[data-clear-recent]", async () => {
      const ok = await Nx.confirm({ title: "Clear your history?", message: "Your recently viewed products will be removed from every device.", confirmLabel: "Clear history" });
      if (ok) apiThen(() => Nx.api("/api/account/recent", { method: "DELETE" }));
    }, signal);
  });

  // ---------- Addresses ----------
  define("account-addresses", (root, signal) => {
    const dialog = root.querySelector("#address-dialog");
    const form = dialog && dialog.querySelector("[data-address-form]");
    if (!form) return;
    const title = dialog.querySelector("#address-dialog-title");

    function open(address) {
      form.reset();
      Nx.clearErrors(form);
      form.elements.id.value = address ? address.id : "";
      if (address) {
        for (const key of ["fullName", "phone", "line1", "line2", "landmark", "city", "state", "pincode"]) form.elements[key].value = address[key] || "";
        form.elements.isDefault.checked = Boolean(address.isDefault);
        form.elements.type.value = address.type || "home";
      }
      title.textContent = address ? "Edit address" : "Add a new address";
      form.querySelector('[type="submit"]').textContent = address ? "Save changes" : "Save address";
      dialog.showModal();
      form.elements.fullName.focus();
    }

    on(root, "click", "[data-address-add]", () => open(null), signal);
    on(root, "click", "[data-address-edit]", (event, button) => open(JSON.parse(button.dataset.address)), signal);
    on(root, "submit", "[data-address-form]", async event => {
      event.preventDefault();
      const values = Nx.formValues(form);
      const id = values.id;
      delete values.id;
      const reply = await Nx.submitForm(form, {
        url: id ? `/api/addresses/${encodeURIComponent(id)}` : "/api/addresses",
        method: id ? "PATCH" : "POST",
        body: values,
        busyLabel: "Saving…"
      });
      if (reply) {
        dialog.close();
        refresh(reply.message);
      }
    }, signal);
    on(root, "click", "[data-address-delete]", async (event, button) => {
      const ok = await Nx.confirm({ title: "Remove this address?", message: `The address for ${button.dataset.name} will be deleted. This cannot be undone.`, confirmLabel: "Remove address" });
      if (!ok) return;
      Nx.busy(button, true, "Removing…");
      if (!(await apiThen(() => Nx.api(`/api/addresses/${encodeURIComponent(button.dataset.addressDelete)}`, { method: "DELETE" })))) Nx.busy(button, false);
    }, signal);
    on(root, "click", "[data-address-default]", async (event, button) => {
      Nx.busy(button, true, "Saving…");
      if (!(await apiThen(() => Nx.api(`/api/addresses/${encodeURIComponent(button.dataset.addressDefault)}/default`, { method: "PATCH" })))) Nx.busy(button, false);
    }, signal);

    return () => { if (dialog.open) dialog.close(); };
  });

  // ---------- Login & security ----------
  const RULES = { length: v => v.length >= 8 && v.length <= 64, letter: v => /[A-Za-z]/.test(v), number: v => /\d/.test(v) };

  function showStrength(form) {
    const input = form.querySelector("[data-strength]");
    if (!input) return;
    let met = 0;
    form.querySelectorAll("[data-rules] [data-rule]").forEach(item => {
      const ok = RULES[item.dataset.rule](input.value);
      if (ok) met += 1;
      item.classList.toggle("is-met", ok);
      const state = item.querySelector("[data-rule-state]");
      if (state) state.textContent = ok ? " (done)" : " (not yet)";
    });
    const bar = form.querySelector("[data-strength-bar]");
    if (bar) bar.dataset.score = input.value ? String(Math.max(1, met)) : "0";
  }

  define("account-security", (root, signal) => {
    on(root, "submit", "[data-profile-form]", async (event, form) => {
      event.preventDefault();
      const reply = await Nx.submitForm(form, { url: "/api/profile", method: "PATCH", busyLabel: "Saving…" });
      if (reply) refresh(reply.message);
    }, signal);

    on(root, "submit", "[data-email-form]", async (event, form) => {
      event.preventDefault();
      const reply = await Nx.submitForm(form, { url: "/api/account/email", method: "PATCH", busyLabel: "Saving…" });
      if (reply) refresh(reply.message);
    }, signal);

    on(root, "input", "[data-password-form] [data-strength]", (event, input) => showStrength(input.form), signal);
    on(root, "submit", "[data-password-form]", async (event, form) => {
      event.preventDefault();
      const values = Nx.formValues(form);
      if (values.newPassword !== values.confirmPassword) {
        Nx.clearErrors(form);
        Nx.showErrors(form, { confirmPassword: "Passwords do not match." });
        return;
      }
      const reply = await Nx.submitForm(form, { url: "/api/profile/password", method: "PATCH", body: values, busyLabel: "Updating…" });
      if (reply) {
        form.reset();
        showStrength(form);
        Nx.formAlert(form, reply.message, "success");
        Nx.toast(reply.message);
      }
    }, signal);

    on(root, "click", "[data-logout-all]", async (event, button) => {
      const ok = await Nx.confirm({ title: "Log out of all devices?", message: "Every device signed in to your account, including this one, will be signed out straight away.", confirmLabel: "Log out everywhere" });
      if (!ok) return;
      Nx.busy(button, true, "Signing out…");
      try {
        const reply = await Nx.api("/api/account/logout-all", { method: "POST" });
        doneThen(reply.message, "/login?reason=logged_out_all");
      } catch (error) {
        Nx.busy(button, false);
        Nx.toast(error.message, "error");
      }
    }, signal);

    on(root, "submit", "[data-delete-form]", async (event, form) => {
      event.preventDefault();
      const ok = await Nx.confirm({ title: "Delete your account?", message: "You will be signed out and won't be able to sign in again. This can't be undone from here.", confirmLabel: "Delete account" });
      if (!ok) return;
      const reply = await Nx.submitForm(form, { url: "/api/account/delete", busyLabel: "Deleting…" });
      if (reply) doneThen(reply.message, "/");
    }, signal);
  });

  // ---------- Notifications: each switch saves as soon as it changes ----------
  define("account-notifications", (root, signal) => {
    on(root, "change", "[data-pref]", async (event, input) => {
      input.disabled = true;
      try {
        await Nx.api("/api/account/preferences", { method: "PATCH", body: { [input.dataset.pref]: input.checked } });
        Nx.toast("Preferences saved.");
      } catch (error) {
        input.checked = !input.checked;
        Nx.toast(error.message, "error");
      } finally {
        input.disabled = false;
      }
    }, signal);
  });

  // ---------- Help: a new request, and replies on a request ----------
  define("account-help", (root, signal) => {
    on(root, "submit", "[data-ticket-form]", async (event, form) => {
      event.preventDefault();
      const reply = await Nx.submitForm(form, { url: "/api/support/tickets", busyLabel: "Sending…" });
      if (reply) go(`/account/help/${reply.ticket.ticketId}`, reply.message);
    }, signal);
  });

  define("account-ticket", (root, signal) => {
    on(root, "submit", "[data-ticket-reply]", async (event, form) => {
      event.preventDefault();
      const reply = await Nx.submitForm(form, { url: `/api/support/tickets/${form.dataset.ticketReply}/messages`, busyLabel: "Sending…" });
      if (reply) refresh(reply.message);
    }, signal);
  });

  // ---------- Phones: the active tab in the account tab bar is scrolled into view ----------
  function showActiveTab() {
    const nav = document.querySelector("[data-acct-nav]");
    const active = nav && nav.querySelector(".acct-link.is-active");
    if (!active || nav.scrollWidth <= nav.clientWidth) return;
    const box = nav.getBoundingClientRect();
    const link = active.getBoundingClientRect();
    nav.scrollLeft += link.left - box.left - (box.width - link.width) / 2;
  }
  window.NxAccount = { showActiveTab };
  showActiveTab();

  // ---------- Start the section on this page ----------
  // (When account-nav.js is on the page, it starts sections itself, including after each swap.)
  if (!window.NxAccountNav) {
    const root = document.querySelector("[data-acct-page]");
    const page = root && Pages[root.dataset.acctPage];
    if (page) page.init(root);
  }
})();
