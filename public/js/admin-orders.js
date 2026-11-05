// Admin Sales sections: orders (filters, bulk status, column picker), one order (status, cancel,
// shipments, notes, refunds, return decisions), returns, transactions, refunds and abandoned carts.
// Each section is a window.NxPages module, so it keeps working after no-reload section switches.
(function () {
  "use strict";

  const Pages = window.NxPages;
  if (!Pages || !Pages.define) return;
  const BASE = document.body.dataset.adminPath || "";
  const money = paise => Nx.formatPrice(paise);
  const go = href => (window.NxNav ? window.NxNav.go(href) : window.location.assign(href));
  const refresh = message => {
    if (window.NxNav) return window.NxNav.reload().then(() => message && Nx.toast(message));
    if (message) Nx.flash(message);
    window.location.reload();
    return Promise.resolve();
  };
  const store = {
    get(key, fallback) { try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; } },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage blocked */ } }
  };

  // Shared: a whole table row opens its page; filter selects apply as soon as they change.
  function tableBasics(root, signal) {
    root.addEventListener("click", event => {
      const row = event.target.closest("tr[data-row-href]");
      if (!row || event.target.closest("a, button, input, select, label, textarea")) return;
      go(row.dataset.rowHref);
    }, { signal });
    root.addEventListener("change", event => {
      const select = event.target.closest("[data-auto-submit]");
      if (select && select.form) select.form.requestSubmit();
    }, { signal });
  }

  // ---------- Orders ----------
  Pages.define("admin-orders", (root, signal) => {
    tableBasics(root, signal);
    const table = root.querySelector("[data-table='orders']");
    const bar = root.querySelector("[data-bulk-bar]");

    // Column picker, remembered in this browser.
    const COLS_KEY = "nx-admin-cols-orders";
    const hidden = new Set(store.get(COLS_KEY, []));
    const applyColumns = () => {
      root.querySelectorAll("[data-col-toggle]").forEach(box => { box.checked = !hidden.has(box.dataset.colToggle); });
      if (table) table.querySelectorAll("[data-col]").forEach(cell => { cell.hidden = hidden.has(cell.dataset.col); });
    };
    root.addEventListener("change", event => {
      const box = event.target.closest("[data-col-toggle]");
      if (!box) return;
      if (box.checked) hidden.delete(box.dataset.colToggle);
      else hidden.add(box.dataset.colToggle);
      store.set(COLS_KEY, [...hidden]);
      applyColumns();
    }, { signal });
    applyColumns();

    // Bulk select.
    const boxes = () => [...root.querySelectorAll("[data-select]")];
    const selected = () => boxes().filter(box => box.checked).map(box => box.dataset.select);
    const showBar = () => {
      const ids = selected();
      bar.hidden = ids.length === 0;
      bar.querySelector("[data-bulk-count]").textContent = `${ids.length} selected`;
      const all = root.querySelector("[data-select-all]");
      if (all) {
        all.checked = ids.length > 0 && ids.length === boxes().length;
        all.indeterminate = ids.length > 0 && ids.length < boxes().length;
      }
      boxes().forEach(box => box.closest("tr").classList.toggle("is-selected", box.checked));
    };
    root.addEventListener("change", event => {
      if (event.target.matches("[data-select-all]")) boxes().forEach(box => { box.checked = event.target.checked; });
      if (event.target.matches("[data-select-all], [data-select]")) showBar();
    }, { signal });
    root.addEventListener("click", async event => {
      if (event.target.closest("[data-bulk-clear]")) {
        boxes().forEach(box => { box.checked = false; });
        showBar();
        return;
      }
      const apply = event.target.closest("[data-bulk-apply]");
      if (!apply) return;
      const status = bar.querySelector("[data-bulk-status]").value;
      const orderIds = selected();
      if (!status) return Nx.toast("Choose the status to move the orders to.", "error");
      const label = bar.querySelector(`[data-bulk-status] option[value="${status}"]`).textContent;
      const ok = await Nx.confirm({ title: `Move ${orderIds.length} ${orderIds.length === 1 ? "order" : "orders"} to ${label}?`, message: "Orders only move forward. Any order that can't take this step is skipped and listed.", confirmLabel: "Move orders", tone: "primary" });
      if (!ok) return;
      Nx.busy(apply, true, "Moving…");
      try {
        const reply = await Nx.api("/api/admin/orders/bulk-status", { method: "POST", body: { orderIds, status } });
        await refresh(reply.message);
        if (reply.skipped.length) Nx.toast(`Skipped: ${reply.skipped.map(s => `${s.orderId} (${s.reason})`).join("; ")}`, "error");
      } catch (error) {
        Nx.busy(apply, false);
        Nx.toast(error.message, "error");
      }
    }, { signal });
  });

  // ---------- One order ----------
  Pages.define("admin-order", (root, signal) => {
    const holder = root.querySelector("[data-admin-order]");
    if (!holder) return;
    const id = encodeURIComponent(holder.dataset.adminOrder);
    const api = path => `/api/admin/orders/${id}${path}`;

    async function send(form, { url, method = "POST", body, confirm, busy }) {
      if (confirm && !(await Nx.confirm(confirm))) return;
      const reply = await Nx.submitForm(form, { url, method, body, busyLabel: busy });
      if (reply) refresh(reply.message);
    }

    root.addEventListener("submit", event => {
      const form = event.target;
      if (form.matches("[data-status-form]")) {
        event.preventDefault();
        const select = form.elements.status;
        const label = select.options[select.selectedIndex].textContent;
        send(form, { url: api("/status"), method: "PATCH", body: { status: select.value }, busy: "Updating…",
          confirm: { title: `Move this order to "${label}"?`, message: "Orders only move forward. The customer's order page updates straight away.", confirmLabel: "Update status", tone: "primary" } });
      } else if (form.matches("[data-cancel-form]")) {
        event.preventDefault();
        const itemIds = [...form.querySelectorAll("input[name='itemIds']:checked")].map(box => box.value);
        const values = Nx.formValues(form);
        send(form, { url: api("/cancel"), body: { itemIds, reason: values.reason, refundMethod: values.refundMethod || "wallet" }, busy: "Cancelling…",
          confirm: { title: itemIds.length ? `Cancel ${itemIds.length} ${itemIds.length === 1 ? "item" : "items"}?` : "Cancel every item that can still be cancelled?", message: "Stock goes back on the shelf, and anything already paid is refunded to the customer.", confirmLabel: "Cancel items" } });
      } else if (form.matches("[data-shipment-form]")) {
        event.preventDefault();
        const values = Nx.formValues(form);
        send(form, { url: api("/shipments"), body: values, busy: "Saving…" });
      } else if (form.matches("[data-note-form]")) {
        event.preventDefault();
        send(form, { url: api("/notes"), busy: "Saving…" });
      } else if (form.matches("[data-refund-form]")) {
        event.preventDefault();
        const values = Nx.formValues(form);
        const paise = Math.round(Number(values.amount) * 100);
        if (!(paise > 0) || paise > Number(form.dataset.max)) {
          Nx.showErrors(form, { amount: `Enter an amount from ₹1 to ${money(Number(form.dataset.max))}.` });
          return;
        }
        send(form, { url: api("/refunds"), body: values, busy: "Refunding…",
          confirm: { title: `Refund ${money(paise)}?`, message: values.method === "original" ? "The money goes back to the customer's card or UPI (5 to 7 working days). This can't be undone." : "The money goes into the customer's Nexthlon wallet straight away. This can't be undone.", confirmLabel: "Refund", tone: "danger" } });
      } else if (form.matches("[data-return-form]")) {
        event.preventDefault();
        const decision = event.submitter && event.submitter.value === "reject" ? "reject" : "approve";
        const values = Nx.formValues(form);
        if (decision === "reject" && values.note.trim().length < 5) {
          Nx.toast("Tell the customer why the return is rejected (at least 5 characters).", "error");
          form.elements.note.focus();
          return;
        }
        send(form, { url: `/api/admin/returns/${id}/decision`, body: { decision, note: values.note, refundMethod: values.refundMethod || "wallet" }, busy: decision === "approve" ? "Approving…" : "Rejecting…",
          confirm: decision === "approve"
            ? { title: "Approve this return?", message: "The items count as returned, their stock goes back on the shelf, and their value is refunded.", confirmLabel: "Approve and refund", tone: "primary" }
            : { title: "Reject this return?", message: "The items stay delivered. The customer sees your note.", confirmLabel: "Reject return" } });
      }
    }, { signal });

    // Opened with #return: show the return panel.
    if (location.hash === "#return") {
      const panel = root.querySelector("#return");
      if (panel) panel.scrollIntoView();
    }
  });

  // ---------- Lists ----------
  ["admin-returns", "admin-transactions", "admin-transaction", "admin-reconciliation"].forEach(name => Pages.define(name, tableBasics));

  Pages.define("admin-refunds", (root, signal) => {
    tableBasics(root, signal);
    root.addEventListener("submit", event => {
      const form = event.target.closest("[data-refund-lookup]");
      if (!form) return;
      event.preventDefault();
      const orderId = form.elements.orderId.value.trim().toUpperCase();
      if (!/^NX-\d{4}-\d{6}$/.test(orderId)) return Nx.toast("Enter an order number like NX-2026-000123.", "error");
      go(`${BASE}/orders/${orderId}`);
    }, { signal });
  });

  // ---------- Abandoned carts ----------
  Pages.define("admin-abandoned-carts", (root, signal) => {
    root.addEventListener("click", async event => {
      const button = event.target.closest("[data-remind]");
      if (!button) return;
      const ok = await Nx.confirm({ title: `Email ${button.dataset.name} a reminder?`, message: "They get a short email listing what is in their cart, with a link back to it. One reminder a day at most.", confirmLabel: "Send reminder", tone: "primary" });
      if (!ok) return;
      Nx.busy(button, true, "Sending…");
      try {
        const reply = await Nx.api(`/api/admin/abandoned-carts/${encodeURIComponent(button.dataset.remind)}/remind`, { method: "POST" });
        const done = document.createElement("span");
        done.className = "pill pill-green";
        done.textContent = reply.delivered ? "Reminder sent" : "Reminder logged";
        button.replaceWith(done);
        Nx.toast(reply.message);
      } catch (error) {
        Nx.busy(button, false);
        Nx.toast(error.message, "error");
      }
    }, { signal });
  });
})();
