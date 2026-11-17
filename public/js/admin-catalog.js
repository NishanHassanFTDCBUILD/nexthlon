// Admin Inventory: type the new stock and press Save. Each changed field is sent as an exact count
// (PATCH /api/admin/inventory/:id); the server checks it, and the row shows what it saved.
(function () {
  "use strict";

  const Pages = window.NxPages;
  if (!Pages || !Pages.define) return;

  const PILL = { out: "pill-red", low: "pill-amber", healthy: "pill-green" };
  const LABEL = { out: "Out of stock", low: "Low", healthy: "In stock" };

  // Brings a row in line with the product the server sent back.
  function paint(row, product) {
    row.querySelector("[data-inv-stock]").textContent = String(product.stock);
    const state = row.querySelector("[data-inv-state]");
    state.textContent = LABEL[product.state];
    state.className = `pill ${PILL[product.state]}`;
    const stockOf = new Map((product.options || []).map(option => [option.id, option.stock]));
    row.querySelectorAll("[data-inv-field]").forEach(field => {
      const stock = field.dataset.optionId ? stockOf.get(field.dataset.optionId) : product.stock;
      field.value = field.dataset.stock = String(stock);
      field.classList.remove("is-changed");
    });
  }

  Pages.define("admin-inventory", (root, signal) => {
    // A field that differs from the saved stock is marked, so it is clear what Save will send.
    root.addEventListener("input", event => {
      const field = event.target.closest("[data-inv-field]");
      if (field) field.classList.toggle("is-changed", field.value !== field.dataset.stock);
    }, { signal });

    root.addEventListener("submit", async event => {
      const form = event.target.closest("[data-inv-form]");
      if (!form) return;
      event.preventDefault();
      const changed = [...form.querySelectorAll("[data-inv-field]")].filter(field => field.value !== field.dataset.stock);
      if (!changed.length) return;
      const invalid = changed.find(field => !/^\d{1,6}$/.test(field.value) || Number(field.value) > 100000);
      if (invalid) {
        Nx.toast("Enter a whole number from 0 to 100,000.", "error");
        invalid.focus();
        return;
      }
      const row = form.closest("[data-inv-row]");
      const button = form.querySelector('[type="submit"]');
      Nx.busy(button, true, "Saving…");
      // Read every value first: the row is redrawn from the server's answer once at the end.
      const bodies = changed.map(field => ({ action: "count", units: Number(field.value), ...(field.dataset.optionId ? { optionId: field.dataset.optionId } : {}) }));
      let reply = null;
      try {
        for (const body of bodies) {
          reply = await Nx.api(`/api/admin/inventory/${encodeURIComponent(form.dataset.invForm)}`, { method: "PATCH", body });
        }
        Nx.toast(bodies.length === 1 ? reply.message : `${bodies.length} sizes saved. ${reply.product.name} now has ${reply.product.stock} in stock.`);
      } catch (error) {
        Nx.toast(error.message, "error");
      } finally {
        if (reply) paint(row, reply.product);
        Nx.busy(button, false);
      }
    }, { signal });
  });
})();
