// Wishlist page: move an item to the cart, or remove it. The server checks every cart rule.
(function () {
  "use strict";

  const page = document.querySelector("[data-wishlist-page]");
  if (!page) return;
  const list = page.querySelector("[data-wishlist-grid]");
  const empty = page.querySelector("[data-wishlist-empty]");
  const summary = document.querySelector("[data-wishlist-summary]");

  function showCount(count) {
    summary.textContent = `${count} saved ${count === 1 ? "item" : "items"}`;
    list.hidden = count === 0;
    empty.hidden = count > 0;
  }

  page.addEventListener("click", async event => {
    const move = event.target.closest("[data-wish-move]");
    const remove = event.target.closest("[data-wish-remove]");
    const row = event.target.closest("[data-wish-item]");
    if (!row || (!move && !remove)) return;
    const id = encodeURIComponent(row.dataset.wishItem);

    if (remove) {
      const ok = await Nx.confirm({ title: "Remove from wishlist?", message: `${row.dataset.name} will be taken off your wishlist.`, confirmLabel: "Remove" });
      if (!ok) return;
    }
    const buttons = row.querySelectorAll("button");
    buttons.forEach(button => { button.disabled = true; });
    row.classList.add("is-busy");
    try {
      const reply = move
        ? await Nx.api(`/api/wishlist/${id}/move-to-cart`, { method: "POST" })
        : await Nx.api(`/api/wishlist/${id}`, { method: "DELETE" });
      row.remove();
      if (reply.cart) Nx.setCartCount(reply.cart.summary.count);
      if (Nx.applyWishlist) Nx.applyWishlist(reply.wishlist);
      showCount(reply.wishlist.count);
      Nx.toast(reply.message);
    } catch (error) {
      Nx.toast(error.message, "error");
      buttons.forEach(button => { button.disabled = false; });
      row.classList.remove("is-busy");
    }
  });
})();
