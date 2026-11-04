// Shopper helpers on every store page: the wishlist and "recently viewed" (both saved in this
// browser), sideways product rails, tabs, and the footer newsletter form.
// Prices on cards drawn here always come fresh from /api/products/lookup, never from storage.
(function () {
  "use strict";

  const Nx = window.Nx || (window.Nx = {});
  const ID = /^[a-f0-9]{24}$/;
  const WISH_KEY = "nx-wishlist";
  const RECENT_KEY = "nx-recent";
  const WISH_MAX = 50;
  const RECENT_MAX = 12;
  // Admins have no wishlist link in the header, so the wishlist and history stay off for them.
  const shopper = Boolean(document.querySelector("[data-wish-link]"));

  // ---------- Saved id lists ----------
  function readIds(key) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "[]");
      return Array.isArray(value) ? value.filter(id => typeof id === "string" && ID.test(id)) : [];
    } catch {
      return [];
    }
  }
  function writeIds(key, ids) {
    try {
      localStorage.setItem(key, JSON.stringify(ids));
      return true;
    } catch {
      return false;
    }
  }

  Nx.lookupProducts = async function lookupProducts(ids) {
    if (!ids.length) return [];
    const data = await Nx.api(`/api/products/lookup?ids=${ids.join(",")}`);
    return Array.isArray(data.products) ? data.products : [];
  };

  // ---------- Product cards drawn in the browser (same markup as partials/product-card.ejs) ----------
  const iconSvg = (name, extra = "") =>
    `<svg class="i ${extra}" aria-hidden="true" focusable="false"><use href="/img/icons.svg#${name}"></use></svg>`;
  const freeDeliveryMin = Number((document.querySelector("[data-site-header]") || {}).dataset?.freeDelivery) || Infinity;

  function stockLabel(stock) {
    const label = document.createElement("span");
    if (stock <= 0) {
      label.className = "stock stock-out";
      label.textContent = "Out of stock";
    } else if (stock <= 5) {
      label.className = "stock stock-low";
      label.textContent = `Only ${stock} left`;
    } else {
      label.className = "stock stock-ok";
      label.textContent = "In stock";
    }
    return label;
  }

  Nx.productCard = function productCard(p) {
    const card = document.createElement("article");
    card.className = "product-card";
    card.innerHTML = `
      <div class="product-media"><img alt="" loading="lazy" decoding="async" width="400" height="400"></div>
      <button type="button" class="wish-btn" aria-pressed="false">${iconSvg("heart")}<span class="sr-only"></span></button>
      <div class="product-body">
        <span class="product-meta"></span>
        <h3 class="product-name"><a></a></h3>
        <div class="price-block"><div class="price-row"><span class="price"></span></div></div>
        <div class="product-foot"></div>
      </div>`;
    const img = card.querySelector("img");
    if (/^(\/|https:\/\/)/.test(p.image || "")) img.src = p.image;
    if (p.discountPercent > 0) {
      const tag = document.createElement("span");
      tag.className = "tag tag-deal";
      tag.textContent = `${p.discountPercent}% off`;
      card.querySelector(".product-media").append(tag);
    }
    const wish = card.querySelector(".wish-btn");
    wish.dataset.wishId = p.id;
    wish.querySelector(".sr-only").textContent = `Save ${p.name} to your wishlist`;
    card.querySelector(".product-meta").textContent = p.brand || "";
    const link = card.querySelector(".product-name a");
    link.href = `/products/${encodeURIComponent(p.slug)}`;
    link.textContent = p.name;
    const row = card.querySelector(".price-row");
    row.querySelector(".price").textContent = Nx.formatPrice(p.price);
    if (p.mrp > p.price) {
      const mrp = document.createElement("span");
      mrp.className = "mrp";
      const struck = document.createElement("s");
      struck.textContent = Nx.formatPrice(p.mrp);
      const hidden = document.createElement("span");
      hidden.className = "sr-only";
      hidden.textContent = "M.R.P. ";
      mrp.append(hidden, struck);
      row.append(mrp);
      if (p.discountPercent > 0) {
        const off = document.createElement("span");
        off.className = "off";
        off.textContent = `${p.discountPercent}% off`;
        row.append(off);
      }
    }
    const foot = card.querySelector(".product-foot");
    foot.append(stockLabel(p.stock));
    if (p.price >= freeDeliveryMin && p.stock > 0) {
      const free = document.createElement("span");
      free.className = "product-delivery";
      free.textContent = "Free delivery";
      foot.append(free);
    }
    return card;
  };

  function skeletons(count) {
    return Array.from({ length: count }, () => {
      const card = document.createElement("div");
      card.className = "skeleton-card";
      card.setAttribute("aria-hidden", "true");
      card.innerHTML = '<div class="skeleton skeleton-media"></div><div class="skeleton skeleton-line"></div><div class="skeleton skeleton-line is-short"></div>';
      return card;
    });
  }

  // ---------- Wishlist ----------
  function showWishlist() {
    const ids = readIds(WISH_KEY);
    document.querySelectorAll("[data-wish-count]").forEach(badge => {
      badge.textContent = String(ids.length);
      badge.hidden = ids.length === 0;
    });
    document.querySelectorAll("[data-wish-link]").forEach(link => {
      link.setAttribute("aria-label", `Wishlist, ${ids.length} ${ids.length === 1 ? "item" : "items"}`);
    });
    document.querySelectorAll("[data-wish-id]").forEach(button => {
      const saved = ids.includes(button.dataset.wishId);
      button.hidden = !shopper;
      button.setAttribute("aria-pressed", String(saved));
      const label = button.querySelector("[data-wish-label]");
      if (label) label.textContent = saved ? "Saved to wishlist" : "Add to wishlist";
    });
  }

  Nx.toggleWish = function toggleWish(id) {
    if (!ID.test(id)) return null;
    const ids = readIds(WISH_KEY);
    const saving = !ids.includes(id);
    const next = saving ? [id, ...ids].slice(0, WISH_MAX) : ids.filter(other => other !== id);
    if (!writeIds(WISH_KEY, next)) {
      Nx.toast("Your browser is blocking saved data, so the wishlist cannot be saved.", "error");
      return null;
    }
    showWishlist();
    return saving;
  };

  document.addEventListener("click", event => {
    const button = event.target.closest("[data-wish-id]");
    if (!button) return;
    event.preventDefault();
    const saved = Nx.toggleWish(button.dataset.wishId);
    if (saved === null) return;
    button.classList.remove("is-popped");
    void button.offsetWidth;
    button.classList.add("is-popped");
    if (saved && readIds(WISH_KEY).length === WISH_MAX) Nx.toast(`Your wishlist holds up to ${WISH_MAX} items; the oldest was removed.`);
    else Nx.toast(saved ? "Saved to your wishlist." : "Removed from your wishlist.");
    if (!saved) document.dispatchEvent(new CustomEvent("nx:wish-removed", { detail: button.dataset.wishId }));
  });
  // Another tab changed the wishlist.
  window.addEventListener("storage", event => {
    if (event.key === WISH_KEY) showWishlist();
  });

  // The wishlist page
  const wishPage = document.querySelector("[data-wishlist-page]");
  if (wishPage) {
    const grid = wishPage.querySelector("[data-wishlist-grid]");
    const empty = wishPage.querySelector("[data-wishlist-empty]");
    const failed = wishPage.querySelector("[data-wishlist-error]");
    const summary = document.querySelector("[data-wishlist-summary]");
    const clear = document.querySelector("[data-wishlist-clear]");

    const showState = (products) => {
      grid.hidden = !products.length;
      empty.hidden = products.length > 0;
      clear.hidden = products.length === 0;
      summary.textContent = products.length
        ? `${products.length} saved ${products.length === 1 ? "item" : "items"}, on this device.`
        : "Saved on this device.";
    };

    const load = async () => {
      failed.hidden = true;
      empty.hidden = true;
      grid.hidden = false;
      grid.setAttribute("aria-busy", "true");
      const ids = readIds(WISH_KEY);
      grid.replaceChildren(...skeletons(Math.min(Math.max(ids.length, 1), 8)));
      try {
        const products = await Nx.lookupProducts(ids);
        // Drop saved items that are no longer sold.
        const live = products.map(p => p.id);
        if (live.length !== ids.length) writeIds(WISH_KEY, ids.filter(id => live.includes(id)));
        grid.replaceChildren(...products.map(Nx.productCard));
        showState(products);
        showWishlist();
      } catch {
        grid.replaceChildren();
        grid.hidden = true;
        failed.hidden = false;
      } finally {
        grid.removeAttribute("aria-busy");
      }
    };

    document.addEventListener("nx:wish-removed", event => {
      const card = grid.querySelector(`[data-wish-id="${event.detail}"]`);
      if (card) card.closest(".product-card").remove();
      showState([...grid.querySelectorAll(".product-card")]);
    });
    wishPage.querySelector("[data-wishlist-retry]").addEventListener("click", load);
    clear.addEventListener("click", async () => {
      const ok = await Nx.confirm({ title: "Clear your wishlist?", message: "Every saved item will be removed from this device.", confirmLabel: "Clear wishlist" });
      if (!ok) return;
      writeIds(WISH_KEY, []);
      grid.replaceChildren();
      showState([]);
      showWishlist();
      Nx.toast("Your wishlist is now empty.");
    });
    load();
  }

  // ---------- Recently viewed ----------
  const viewed = document.querySelector("[data-recent-id]");
  if (shopper && viewed && ID.test(viewed.dataset.recentId)) {
    const id = viewed.dataset.recentId;
    writeIds(RECENT_KEY, [id, ...readIds(RECENT_KEY).filter(other => other !== id)].slice(0, RECENT_MAX));
  }

  const recent = document.querySelector("[data-recent]");
  if (recent) {
    const track = recent.querySelector("[data-recent-track]");
    const failed = recent.querySelector("[data-recent-error]");
    const rail = recent.querySelector("[data-rail]");
    const load = async () => {
      const ids = readIds(RECENT_KEY);
      if (!ids.length) {
        recent.hidden = true;
        return;
      }
      recent.hidden = false;
      failed.hidden = true;
      rail.hidden = false;
      track.setAttribute("aria-busy", "true");
      track.replaceChildren(...skeletons(Math.min(ids.length, 5)));
      try {
        const products = await Nx.lookupProducts(ids);
        if (!products.length) {
          recent.hidden = true;
          return;
        }
        track.replaceChildren(...products.map(Nx.productCard));
        showWishlist();
        if (Nx.updateRail) Nx.updateRail(rail);
      } catch {
        rail.hidden = true;
        failed.hidden = false;
      } finally {
        track.removeAttribute("aria-busy");
      }
    };
    recent.querySelector("[data-recent-retry]").addEventListener("click", load);
    recent.querySelector("[data-recent-clear]").addEventListener("click", () => {
      writeIds(RECENT_KEY, []);
      recent.hidden = true;
      Nx.toast("Your browsing history on this device was cleared.");
    });
    load();
  }

  // ---------- Product rails: scroll buttons ----------
  Nx.updateRail = function updateRail(rail) {
    const track = rail.querySelector("[data-rail-track]");
    const prev = rail.querySelector('[data-rail-step="-1"]');
    const next = rail.querySelector('[data-rail-step="1"]');
    if (!track || !prev || !next) return;
    const max = track.scrollWidth - track.clientWidth - 2;
    prev.disabled = track.scrollLeft <= 2;
    next.disabled = track.scrollLeft >= max;
  };

  document.querySelectorAll("[data-rail]").forEach(rail => {
    const track = rail.querySelector("[data-rail-track]");
    if (!track) return;
    rail.classList.add("is-enhanced");
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => Nx.updateRail(rail));
    };
    rail.querySelectorAll("[data-rail-step]").forEach(button => {
      button.addEventListener("click", () => {
        const step = Number(button.dataset.railStep);
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        track.scrollBy({ left: step * track.clientWidth * 0.9, behavior: reduce ? "auto" : "smooth" });
      });
    });
    track.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update, { passive: true });
    update();
  });

  // ---------- Tabs ----------
  document.querySelectorAll("[data-tabs]").forEach(box => {
    const tabs = [...box.querySelectorAll('[role="tab"]')];
    if (!tabs.length) return;
    box.classList.add("is-enhanced");
    const select = (tab, focus) => {
      tabs.forEach(other => {
        const on = other === tab;
        other.setAttribute("aria-selected", String(on));
        other.tabIndex = on ? 0 : -1;
        const panel = document.getElementById(other.getAttribute("aria-controls"));
        if (panel) panel.hidden = !on;
      });
      if (focus) tab.focus();
    };
    tabs.forEach((tab, index) => {
      tab.addEventListener("click", () => select(tab, false));
      tab.addEventListener("keydown", event => {
        const moves = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: tabs.length - 1 };
        if (!(event.key in moves)) return;
        event.preventDefault();
        select(tabs[(moves[event.key] + tabs.length) % tabs.length], true);
      });
    });
    select(tabs[0], false);
  });

  // ---------- Newsletter (footer) ----------
  document.querySelectorAll("[data-newsletter]").forEach(form => {
    form.addEventListener("submit", async event => {
      event.preventDefault();
      const reply = await Nx.submitForm(form, { url: "/api/newsletter", busyLabel: "Subscribing…" });
      if (!reply) return;
      form.reset();
      Nx.formAlert(form, reply.message, "success");
    });
  });

  showWishlist();
})();
