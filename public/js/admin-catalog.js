// Admin Catalog section: the Inventory page.
// Every change goes through PATCH /api/admin/inventory/:id (or the bulk route); the server
// answers with the product as it is now, and its row is brought in line. Each message offers Undo.
// Section modules use window.NxPages (section-nav.js), so they keep working when sections switch.
(function () {
  "use strict";

  const Pages = window.NxPages;
  if (!Pages || !Pages.define) return;

  const STATE_PILL = { out: "pill-red", low: "pill-amber", healthy: "pill-green" };
  const STATE_LABEL = { out: "Out of stock", low: "Low", healthy: "In stock" };

  const reload = message => {
    if (window.NxNav) return window.NxNav.reload().then(() => message && Nx.toast(message));
    if (message) Nx.flash(message);
    window.location.reload();
    return Promise.resolve();
  };

  Pages.define("admin-inventory", (root, signal) => {
    const on = (type, handler) => root.addEventListener(type, handler, { signal });
    const rowOf = id => root.querySelector(`[data-inv-row="${CSS.escape(id)}"]`);

    // Brings one row in line with the product the server sent back.
    function paint(product) {
      const row = rowOf(product.id);
      if (!row) return;
      (product.options || []).forEach(option => {
        const item = row.querySelector(`[data-inv-option="${CSS.escape(option.id)}"]`);
        if (!item) return;
        item.className = `inv-option is-${option.state}`;
        const input = item.querySelector("[data-inv-option-input]");
        input.value = String(option.stock);
        input.dataset.stock = String(option.stock);
      });
      row.querySelector("[data-inv-stock]").textContent = String(product.stock);
      const state = row.querySelector("[data-inv-state]");
      state.textContent = STATE_LABEL[product.state];
      state.className = `pill ${STATE_PILL[product.state]}`;
      row.querySelector("[data-inv-value]").textContent = Nx.formatPrice(product.stockValue);
    }

    // The opposite of a change that moved stock, for Undo. Add and remove (not "set") so an order
    // placed in between is not overwritten.
    function undoOf(body, reply) {
      const moved = reply.after - reply.before;
      if (!moved) return null;
      return { action: moved > 0 ? "remove" : "add", units: Math.abs(moved), note: "Undo", ...(body.optionId ? { optionId: body.optionId } : {}) };
    }

    async function change(id, body, { offerUndo = true } = {}) {
      const reply = await Nx.api(`/api/admin/inventory/${encodeURIComponent(id)}`, { method: "PATCH", body });
      paint(reply.product);
      const undo = offerUndo ? undoOf(body, reply) : null;
      Nx.toast(reply.message, "success", undo ? { action: { label: "Undo", run: () => change(id, undo, { offerUndo: false }).catch(error => Nx.toast(error.message, "error")) } } : {});
      return reply;
    }

    const optionOf = element => {
      const item = element.closest("[data-inv-option]");
      return item ? item.dataset.invOption : null;
    };

    // ---------- Quick buttons: −1, +1, +10 (whole product or one size) ----------
    on("click", async event => {
      const button = event.target.closest("[data-inv-step]");
      if (!button) return;
      const id = button.closest("[data-inv-row]").dataset.invRow;
      const step = Number(button.dataset.invStep);
      const optionId = optionOf(button);
      button.disabled = true;
      try {
        await change(id, { action: step > 0 ? "add" : "remove", units: Math.abs(step), ...(optionId ? { optionId } : {}) });
      } catch (error) {
        Nx.toast(error.message, "error");
      } finally {
        button.disabled = false;
      }
    });

    // ---------- Sizes in place: type a number, press Enter (or leave the field) ----------
    on("change", async event => {
      const input = event.target.closest("[data-inv-option-input]");
      if (!input) return;
      const units = Number(input.value);
      if (!Number.isInteger(units) || units < 0 || units > 100000) {
        Nx.toast("Enter a whole number from 0 to 100,000.", "error");
        input.value = input.dataset.stock;
        return;
      }
      if (String(units) === input.dataset.stock) return;
      const id = input.closest("[data-inv-row]").dataset.invRow;
      input.disabled = true;
      try {
        await change(id, { action: "count", units, optionId: optionOf(input) });
      } catch (error) {
        Nx.toast(error.message, "error");
        input.value = input.dataset.stock;
      } finally {
        input.disabled = false;
      }
    });
    on("keydown", event => {
      if (event.key === "Enter" && event.target.matches("[data-inv-option-input]")) {
        event.preventDefault();
        event.target.blur();
      }
    });

    // ---------- One product: add, remove or set ----------
    on("submit", async event => {
      const form = event.target.closest("[data-inv-form]");
      if (!form) return;
      event.preventDefault();
      const action = form.elements.action.value;
      const units = Number(form.elements.units.value);
      if (!Number.isInteger(units) || units < 0 || units > 100000 || (action !== "count" && units < 1)) {
        Nx.toast("Enter a whole number of units.", "error");
        form.elements.units.focus();
        return;
      }
      const button = form.querySelector('[type="submit"]');
      Nx.busy(button, true, "Saving…");
      try {
        await change(form.dataset.invForm, { action, units });
        form.elements.units.value = "";
      } catch (error) {
        Nx.toast(error.message, "error");
      } finally {
        Nx.busy(button, false);
      }
    });

    // ---------- Bulk: tick products, then add, remove or set for all of them ----------
    const bulk = root.querySelector("[data-inv-bulk]");
    const picks = () => [...root.querySelectorAll("[data-inv-pick]:not(:disabled)")];
    function syncBulk() {
      const chosen = picks().filter(box => box.checked);
      if (!bulk) return;
      bulk.hidden = chosen.length === 0;
      bulk.querySelector("[data-inv-bulk-count]").textContent = `${chosen.length} selected`;
      const all = root.querySelector("[data-inv-pick-all]");
      if (all) all.checked = chosen.length > 0 && chosen.length === picks().length;
    }
    on("change", event => {
      if (event.target.matches("[data-inv-pick-all]")) picks().forEach(box => { box.checked = event.target.checked; });
      if (event.target.matches("[data-inv-pick], [data-inv-pick-all]")) syncBulk();
    });
    on("click", event => {
      if (!event.target.closest("[data-inv-bulk-clear]")) return;
      picks().forEach(box => { box.checked = false; });
      syncBulk();
    });
    on("submit", async event => {
      if (!event.target.matches("[data-inv-bulk]")) return;
      event.preventDefault();
      const form = event.target;
      const productIds = picks().filter(box => box.checked).map(box => box.value);
      const action = form.elements.action.value;
      const units = Number(form.elements.units.value);
      if (!Number.isInteger(units) || units < 0 || units > 100000 || (action !== "count" && units < 1)) {
        Nx.toast("Enter a whole number of units.", "error");
        return;
      }
      if (action === "count") {
        const ok = await Nx.confirm({ title: `Set ${productIds.length} products to ${units} in stock?`, message: "This replaces each current number. Use it after counting the shelf.", confirmLabel: "Set the stock", tone: "primary" });
        if (!ok) return;
      }
      const button = form.querySelector('[type="submit"]');
      Nx.busy(button, true, "Applying…");
      try {
        const reply = await Nx.api("/api/admin/inventory/bulk", { method: "POST", body: { productIds, action, units } });
        reply.products.forEach(paint);
        Nx.toast(reply.message, reply.skipped.length ? "info" : "success");
        form.elements.units.value = "";
        picks().forEach(box => { box.checked = false; });
        syncBulk();
      } catch (error) {
        Nx.toast(error.message, "error");
      } finally {
        Nx.busy(button, false);
      }
    });

    // ---------- History ----------
    const historyDialog = root.querySelector("#inv-history");
    const when = value => new Date(value).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
    const VERB = { add: "Added", remove: "Removed", count: "Set to" };
    on("click", async event => {
      const button = event.target.closest("[data-inv-history]");
      if (!button || !historyDialog) return;
      const list = historyDialog.querySelector("[data-inv-history-list]");
      historyDialog.querySelector("[data-inv-history-name]").textContent = button.dataset.name;
      list.replaceChildren();
      historyDialog.showModal();
      try {
        const { history } = await Nx.api(`/api/admin/inventory/${encodeURIComponent(button.dataset.invHistory)}/history`);
        if (!history.length) {
          const empty = document.createElement("li");
          empty.className = "muted";
          empty.textContent = "No stock changes recorded yet.";
          list.append(empty);
          return;
        }
        history.forEach(entry => {
          const item = document.createElement("li");
          const what = document.createElement("strong");
          what.textContent = `${VERB[entry.action] || "Changed"} ${entry.units}${entry.option ? ` · ${entry.option}` : ""}`;
          const detail = document.createElement("span");
          detail.textContent = `${entry.before} → ${entry.after}${entry.note ? ` · ${entry.note}` : ""}`;
          const meta = document.createElement("small");
          meta.className = "muted";
          meta.textContent = `${entry.by} · ${when(entry.at)}`;
          item.append(what, detail, meta);
          list.append(item);
        });
      } catch (error) {
        Nx.toast(error.message, "error");
      }
    });

    on("click", event => {
      const close = event.target.closest("[data-inv-close]");
      if (close) close.closest("dialog").close();
    });
  });
})();
