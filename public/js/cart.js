// Add to cart on the product page, and the cart page (+/- quantity, remove, live totals).
// Prices shown here always come from the server's reply; the browser never sends a price.
(function () {
  "use strict";

  const rupees = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
  const formatPrice = value => rupees.format(value || 0);
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  // ---------- Fly to cart ----------
  // A small copy of the product photo flies to the header cart icon. Only transform and opacity move.
  function flyToCart(sourceImg) {
    const target = document.querySelector("[data-cart-link] .cart-icon");
    if (!sourceImg || !target || reducedMotion.matches || typeof sourceImg.animate !== "function") return Promise.resolve();
    const from = sourceImg.getBoundingClientRect();
    const to = target.getBoundingClientRect();
    if (!from.width || !to.width) return Promise.resolve();

    const size = Math.min(120, from.width * 0.4);
    const ghost = document.createElement("img");
    ghost.src = sourceImg.currentSrc || sourceImg.src;
    ghost.alt = "";
    ghost.className = "fly-ghost";
    ghost.style.width = `${size}px`;
    ghost.style.height = `${size}px`;
    ghost.style.left = `${from.left + from.width / 2 - size / 2}px`;
    ghost.style.top = `${from.top + from.height / 2 - size / 2}px`;
    document.body.append(ghost);

    const dx = to.left + to.width / 2 - (from.left + from.width / 2);
    const dy = to.top + to.height / 2 - (from.top + from.height / 2);
    const animation = ghost.animate([
      { transform: "translate(0, 0) scale(1)", opacity: 1 },
      { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 60}px) scale(0.6)`, opacity: 0.9, offset: 0.55 },
      { transform: `translate(${dx}px, ${dy}px) scale(0.12)`, opacity: 0.2 }
    ], { duration: 750, easing: "cubic-bezier(0.5, 0, 0.2, 1)" });
    return animation.finished.catch(() => {}).then(() => ghost.remove());
  }

  // ---------- Quantity stepper on the product page ----------
  function setupStepper(root) {
    const input = root.querySelector("[data-qty-input]");
    const minus = root.querySelector('[data-qty-step="-1"]');
    const plus = root.querySelector('[data-qty-step="1"]');
    const max = Number(input.max) || 1;
    const clamp = () => {
      const value = Math.min(max, Math.max(1, Math.round(Number(input.value)) || 1));
      input.value = String(value);
      minus.disabled = value <= 1;
      plus.disabled = value >= max;
      return value;
    };
    root.querySelectorAll("[data-qty-step]").forEach(button => {
      button.addEventListener("click", () => {
        input.value = String((Number(input.value) || 1) + Number(button.dataset.qtyStep));
        clamp();
      });
    });
    input.addEventListener("change", clamp);
    return clamp;
  }

  const addForm = document.querySelector("[data-add-to-cart]");
  if (addForm) {
    const readQuantity = setupStepper(addForm.querySelector("[data-qty]"));
    addForm.addEventListener("submit", async event => {
      event.preventDefault();
      const button = addForm.querySelector('[type="submit"]');
      Nx.busy(button, true, "Adding…");
      try {
        const result = await Nx.api("/api/cart/items", {
          method: "POST",
          body: { productId: addForm.dataset.productId, quantity: readQuantity() }
        });
        Nx.busy(button, false);
        await flyToCart(document.querySelector("[data-gallery-main]"));
        Nx.setCartCount(result.cart.summary.count);
        Nx.toast(result.message);
      } catch (error) {
        Nx.busy(button, false);
        Nx.toast(error.message, "error");
      }
    });
  }

  // ---------- Cart page ----------
  const page = document.querySelector("[data-cart]");
  if (!page) return;
  const listPanel = page.querySelector("[data-cart-list-panel]");
  const summaryBox = page.querySelector("[data-cart-summary]");
  const empty = page.querySelector("[data-cart-empty]");
  const headingCount = page.querySelector("[data-cart-heading-count]");

  // Brings every number on the page in line with the cart the server sent back.
  function render(cart) {
    const { items, summary } = cart;
    const byId = new Map(items.map(item => [item.productId, item]));
    page.querySelectorAll("[data-cart-item]").forEach(row => {
      const item = byId.get(row.dataset.cartItem);
      if (!item) {
        row.remove();
        return;
      }
      row.querySelector("[data-cart-qty]").textContent = String(item.quantity);
      row.querySelector("[data-cart-line-total]").textContent = item.available ? formatPrice(item.lineTotal) : "—";
      row.querySelector('[data-cart-step="-1"]').disabled = !item.available || item.quantity <= 1;
      row.querySelector('[data-cart-step="1"]').disabled = !item.available || item.quantity >= item.maxQuantity;
    });

    const set = (key, text) => page.querySelectorAll(`[data-summary="${key}"]`).forEach(el => { el.textContent = text; });
    set("mrpTotal", formatPrice(summary.mrpTotal));
    set("savings", `−${formatPrice(summary.savings)}`);
    set("savings-plain", formatPrice(summary.savings));
    set("subtotal", formatPrice(summary.subtotal));
    set("grandTotal", formatPrice(summary.grandTotal));
    set("itemCount", String(summary.itemCount));
    page.querySelectorAll("[data-summary-items]").forEach(el => { el.textContent = summary.itemCount === 1 ? "item" : "items"; });
    const savingNote = page.querySelector("[data-summary-saving-note]");
    if (savingNote) savingNote.hidden = !(summary.savings > 0);
    const unavailableNote = page.querySelector("[data-cart-unavailable-note]");
    if (unavailableNote) unavailableNote.hidden = summary.unavailableCount === 0;
    headingCount.textContent = `${summary.count} ${summary.count === 1 ? "item" : "items"}`;

    const isEmpty = items.length === 0;
    listPanel.hidden = isEmpty;
    summaryBox.hidden = isEmpty;
    empty.hidden = !isEmpty;
    Nx.setCartCount(summary.count);
  }

  // Runs one cart change while the row shows it is busy. Errors leave the row as it was.
  async function change(row, request) {
    row.classList.add("is-busy");
    row.setAttribute("aria-busy", "true");
    row.querySelectorAll("button").forEach(button => { button.disabled = true; });
    try {
      const result = await request();
      render(result.cart);
      Nx.toast(result.message);
    } catch (error) {
      Nx.toast(error.message, "error");
      // Reload the true state, so the buttons match the server again.
      try {
        render((await Nx.api("/api/cart")).cart);
      } catch {
        /* the first error toast is enough */
      }
    } finally {
      if (row.isConnected) {
        row.classList.remove("is-busy");
        row.removeAttribute("aria-busy");
        row.querySelector("[data-cart-remove]").disabled = false;
      }
    }
  }

  page.addEventListener("click", async event => {
    const step = event.target.closest("[data-cart-step]");
    const remove = event.target.closest("[data-cart-remove]");
    const row = event.target.closest("[data-cart-item]");
    if (!row || (!step && !remove)) return;
    const id = encodeURIComponent(row.dataset.cartItem);

    if (step) {
      const quantity = Number(row.querySelector("[data-cart-qty]").textContent) + Number(step.dataset.cartStep);
      await change(row, () => Nx.api(`/api/cart/items/${id}`, { method: "PATCH", body: { quantity } }));
      return;
    }
    const confirmed = await Nx.confirm({
      title: "Remove this item?",
      message: `${row.dataset.name} will be taken out of your cart.`,
      confirmLabel: "Remove"
    });
    if (confirmed) await change(row, () => Nx.api(`/api/cart/items/${id}`, { method: "DELETE" }));
  });
})();
