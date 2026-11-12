// Add to cart on the product page, and the cart page (+/- quantity, remove, live totals).
// Prices shown here always come from the server's reply; the browser never sends a price.
(function () {
  "use strict";

  // Money from the API is in paise.
  const formatPrice = value => Nx.formatPrice(value);

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
    // The shared Nx.addToCart (store.js): the photo flies from the gallery the moment you press the button.
    addForm.addEventListener("submit", async event => {
      event.preventDefault();
      // From the big photo, or from the sticky buy bar's photo when the big one has scrolled away.
      const gallery = document.querySelector("[data-gallery-main]");
      const box = gallery ? gallery.getBoundingClientRect() : null;
      const onScreen = box && box.bottom > 40 && box.top < window.innerHeight - 40;
      const result = await Nx.addToCart({
        productId: addForm.dataset.productId,
        quantity: readQuantity(),
        source: onScreen ? gallery : document.querySelector("[data-dock] img") || gallery,
        src: gallery ? gallery.currentSrc || gallery.src : "",
        button: addForm.querySelector('[type="submit"]')
      });
      // The product page shows "N already in your cart" from this.
      if (result.ok) addForm.dispatchEvent(new CustomEvent("nx:cart-added", { detail: result.cart }));
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
      Nx.rollNumber(row.querySelector("[data-cart-qty]"), item.quantity);
      row.querySelector("[data-cart-line-total]").textContent = item.available ? formatPrice(item.lineTotal) : "—";
      row.querySelector('[data-cart-step="-1"]').disabled = !item.available || item.quantity <= 1;
      row.querySelector('[data-cart-step="1"]').disabled = !item.available || item.quantity >= item.maxQuantity;
    });

    const set = (key, text) => page.querySelectorAll(`[data-summary="${key}"]`).forEach(el => { el.textContent = text; });
    set("mrpTotal", formatPrice(summary.mrpTotal));
    set("savings", `−${formatPrice(summary.savings)}`);
    set("savings-plain", formatPrice(summary.savings));
    set("grandTotal", formatPrice(summary.grandTotal));
    set("freeDeliveryGap", formatPrice(summary.freeDeliveryGap));
    page.querySelectorAll('[data-summary="deliveryFee"]').forEach(el => {
      if (summary.deliveryFee) el.textContent = formatPrice(summary.deliveryFee);
      else el.innerHTML = '<span class="text-success">Free</span>';
    });
    const freeNote = page.querySelector("[data-free-note]");
    if (freeNote) freeNote.hidden = !summary.freeDeliveryGap;
    const checkout = page.querySelector("[data-checkout-link]");
    if (checkout) {
      if (summary.itemCount) {
        checkout.removeAttribute("aria-disabled");
        checkout.removeAttribute("tabindex");
      } else {
        checkout.setAttribute("aria-disabled", "true");
        checkout.setAttribute("tabindex", "-1");
      }
    }
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
        row.querySelectorAll("[data-cart-remove], [data-cart-save]").forEach(button => { button.disabled = false; });
      }
    }
  }

  page.addEventListener("click", async event => {
    const step = event.target.closest("[data-cart-step]");
    const remove = event.target.closest("[data-cart-remove]");
    const save = event.target.closest("[data-cart-save]");
    const row = event.target.closest("[data-cart-item]");
    if (!row || (!step && !remove && !save)) return;
    const id = encodeURIComponent(row.dataset.cartItem);

    if (save) {
      await change(row, async () => {
        const reply = await Nx.api(`/api/cart/items/${id}/save-for-later`, { method: "POST" });
        if (Nx.applyWishlist) Nx.applyWishlist(reply.wishlist);
        return reply;
      });
      return;
    }

    if (step) {
      const shown = row.querySelector("[data-cart-qty]");
      const quantity = Number(shown.dataset.value || shown.textContent) + Number(step.dataset.cartStep);
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
