// Admin Catalog section: inventory corrections.
// No animation and no libraries: a change is sent, the server answers, the row is brought in line.
// Section modules use window.NxPages (section-nav.js), so they keep working when sections switch
// without a reload.
(function () {
  "use strict";

  const Pages = window.NxPages;
  if (!Pages || !Pages.define) return;

  const reload = message => {
    if (window.NxNav) return window.NxNav.reload().then(() => message && Nx.toast(message));
    if (message) Nx.flash(message);
    window.location.reload();
    return Promise.resolve();
  };

  // ---------- Inventory ----------

  const STATE_PILL = { out: "pill-red", low: "pill-amber", healthy: "pill-green" };
  const STATE_LABEL = { out: "Out of stock", low: "Low", healthy: "In stock" };

  Pages.define("admin-inventory", (root, signal) => {
    root.addEventListener("submit", async event => {
      const form = event.target.closest("[data-inv-form]");
      if (!form) return;
      event.preventDefault();
      const id = form.dataset.invForm;
      const name = form.dataset.name;
      const action = form.elements.action.value;
      const units = Number(form.elements.units.value);
      const button = form.querySelector("button");
      // A product with sizes or colours: which one to change.
      const optionField = form.elements.optionId;
      const optionId = optionField ? optionField.value : "";
      const optionName = optionField && optionField.selectedOptions[0] ? optionField.selectedOptions[0].textContent.replace(/\s*\(\d+\)$/, "") : "";
      if (optionField && !optionId) {
        Nx.toast("Choose the size or colour to change.", "error");
        optionField.focus();
        return;
      }

      // The server checks this again; stopping here just saves a pointless round trip.
      if (!Number.isInteger(units) || units < 0 || units > 100000 || (action !== "count" && units < 1)) {
        Nx.toast("Enter a whole number of units.", "error");
        form.elements.units.focus();
        return;
      }
      // Setting an exact count can lose stock by accident, so it asks first.
      if (action === "count") {
        const ok = await Nx.confirm({
          title: `Set ${name}${optionName ? ` (${optionName})` : ""} to ${units} in stock?`,
          message: "This replaces the current number, it does not add to it. Use it after counting the shelf.",
          confirmLabel: "Set the stock",
          tone: "primary"
        });
        if (!ok) return;
      }

      Nx.busy(button, true, "Saving…");
      try {
        const body = { action, units };
        if (optionId) body.optionId = optionId;
        const reply = await Nx.api(`/api/admin/inventory/${encodeURIComponent(id)}`, { method: "PATCH", body });
        const product = reply.product;
        const row = root.querySelector(`[data-inv-row="${id}"]`);
        if (row) {
          // Each size's number and state, and the stock shown in the size list.
          (product.options || []).forEach(option => {
            const item = row.querySelector(`[data-inv-option="${option.id}"]`);
            if (item) {
              item.querySelector("[data-inv-option-stock]").textContent = String(option.stock);
              item.className = `inv-option is-${option.state}`;
            }
            const choice = optionField && [...optionField.options].find(entry => entry.value === option.id);
            if (choice) choice.textContent = `${option.label} (${option.stock})`;
          });
          row.querySelector("[data-inv-stock]").textContent = String(product.stock);
          const state = row.querySelector("[data-inv-state]");
          state.textContent = STATE_LABEL[product.state];
          state.className = `pill ${STATE_PILL[product.state]}`;
          row.querySelector("[data-inv-value]").textContent = Nx.formatPrice(product.stockValue);
        }
        form.elements.units.value = "";
        Nx.toast(reply.message);
      } catch (error) {
        Nx.toast(error.message, "error");
      } finally {
        Nx.busy(button, false);
      }
    }, { signal });
  });
})();
