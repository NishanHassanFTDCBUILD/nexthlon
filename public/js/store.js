// Shopper helpers on every store page: wishlist hearts (saved on the server), "recently viewed"
// (saved in this browser), sideways product rails, tabs, and the footer newsletter form.
// Prices on cards drawn here always come fresh from the API, never from storage.
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

  // ---------- Fly to cart ----------
  // The product photo flies along a curve to the header cart icon the moment it is tapped, at the same
  // time as the request (so it never waits for the server), and the cart icon catches it. If the server
  // says no, the photo flies back to where it came from. Only transform and opacity move.
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const NO_FLIGHT = { landed: Promise.resolve(), abort() {} };

  // Where the cart icon will be once the header is fully on screen. On phones the header tucks away
  // while scrolling down; it is brought back (and held) first, so the photo lands on an icon you can see.
  function cartTarget(holdMs) {
    const icon = document.querySelector("[data-cart-link] .cart-icon");
    if (!icon || !icon.getClientRects().length) return null;
    const header = icon.closest("[data-site-header]");
    let shift = 0;
    if (header && header.classList.contains("is-tucked") && Nx.showHeader) {
      shift = new DOMMatrix(getComputedStyle(header).transform).m42 || 0;
      Nx.showHeader(holdMs);
    }
    const box = icon.getBoundingClientRect();
    const rect = { left: box.left, top: box.top - shift, width: box.width, height: box.height };
    // A header that is not sticky can be scrolled away: land in the top corner instead.
    if (rect.top + rect.height < 0) return { icon: null, x: window.innerWidth - 40, y: 24 };
    return { icon, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  // The cart icon "catches" the photo: a quick squash and a ring of light.
  function catchAt(icon) {
    if (!icon) return;
    icon.classList.remove("is-catching");
    void icon.offsetWidth;
    icon.classList.add("is-catching");
    setTimeout(() => icon.classList.remove("is-catching"), Nx.motionMs("--duration-slower", 700));
  }

  // Starts a flight from an element (a photo, or a whole card) showing the photo src.
  // Returns { landed, abort }: landed resolves when the photo reaches the cart (or straight away when
  // there is no flight); abort() sends it back to where it came from.
  Nx.startFlight = function startFlight(source, src) {
    if (!source || reducedMotion.matches || typeof Element.prototype.animate !== "function") return NO_FLIGHT;
    const from = source.getBoundingClientRect();
    const photo = src || (source.tagName === "IMG" ? source.currentSrc || source.src : "");
    // Nothing to fly from (no photo, or the photo is off screen): the cart icon still catches the item.
    if (!from.width || !photo || from.bottom < 0 || from.top > window.innerHeight) return NO_FLIGHT;
    const duration = Nx.motionMs("--duration-slower", 700);
    const target = cartTarget(duration + 1200);
    if (!target) return NO_FLIGHT;

    const size = Math.max(56, Math.min(120, from.width * 0.42));
    const sx = from.left + from.width / 2;
    const sy = from.top + from.height / 2;
    const ghost = document.createElement("img");
    ghost.src = photo;
    ghost.alt = "";
    ghost.className = "fly-ghost";
    ghost.setAttribute("aria-hidden", "true");
    ghost.style.width = `${size}px`;
    ghost.style.height = `${size}px`;
    ghost.style.left = `${sx - size / 2}px`;
    ghost.style.top = `${sy - size / 2}px`;
    document.body.append(ghost);

    // A curve that rises above both ends, leaning towards the side it comes from.
    const dx = target.x - sx;
    const dy = target.y - sy;
    const lift = Math.max(90, Math.hypot(dx, dy) * 0.32);
    const cx = dx * 0.35;
    const cy = Math.min(0, dy) - lift;
    const STEPS = 12;
    const frames = [];
    for (let i = 0; i <= STEPS; i += 1) {
      const t = i / STEPS;
      const u = 1 - t;
      const x = 2 * u * t * cx + t * t * dx;
      const y = 2 * u * t * cy + t * t * dy;
      const scale = 1 - 0.84 * t * t;                       // shrinks most at the end
      const spin = Math.sin(t * Math.PI) * (dx >= 0 ? 14 : -14); // tips into the turn, then levels
      frames.push({
        offset: t,
        transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${spin.toFixed(1)}deg) scale(${scale.toFixed(3)})`,
        opacity: t < 0.82 ? 1 : 1 - (t - 0.82) * 3.6
      });
    }
    // A short lift-off from the card before the flight.
    frames[1] = { ...frames[1], transform: `${frames[1].transform} scale(1.08)` };
    const animation = ghost.animate(frames, { duration, easing: Nx.motionEase("--ease-in-out"), fill: "forwards" });

    let aborted = false;
    const arrived = animation.finished.then(() => {
      if (aborted) return;
      catchAt(target.icon);
      ghost.remove();
    }, () => {});
    // Browsers pause animations in background tabs: the cart count and message never wait on the flight
    // for longer than it should take.
    const landed = Promise.race([arrived, new Promise(resolve => setTimeout(resolve, duration + 250))]);
    return {
      landed,
      abort() {
        if (aborted) return;
        aborted = true;
        // Fly back to the card from wherever it is now, and fade out there.
        const back = animation.playState === "finished" ? null : animation;
        if (back) {
          back.updatePlaybackRate(-1.6);
          back.finished.catch(() => {}).then(() => ghost.remove());
        } else {
          ghost.remove();
        }
      }
    };
  };

  // Kept for older callers: one flight from a photo, resolving when it lands.
  Nx.flyToCart = function flyToCart(sourceImg, src) {
    return Nx.startFlight(sourceImg, src).landed;
  };

  // ---------- Add to cart (every button on the site goes through here) ----------
  // { productId, quantity, source, src, button, href }
  //   source  the element the photo flies from (a photo or a card); src the photo to fly
  //   button  disabled while the request runs; quick-add buttons (.card-add) also show "added" or "max"
  //   href    where a guest comes back to after signing in
  // Resolves { ok: true, cart } or { ok: false, error }. Never throws.
  const header = document.querySelector("[data-site-header]");
  const role = header ? header.dataset.shopper : "admin";
  const inFlight = new WeakSet();

  function markButton(button, state) {
    if (!button || !button.classList.contains("card-add")) return;
    button.classList.remove("is-added", "is-max");
    if (!state) return;
    button.classList.add(`is-${state}`);
    const label = button.querySelector(".sr-only");
    if (label && !button.dataset.label) button.dataset.label = label.textContent;
    if (label) label.textContent = state === "max" ? "The most you can buy is already in your cart" : "Added to your cart";
    if (state === "added") {
      setTimeout(() => {
        button.classList.remove("is-added");
        if (label && button.dataset.label) label.textContent = button.dataset.label;
      }, 1800);
    }
  }

  Nx.addToCart = async function addToCart({ productId, quantity = 1, source, src, button, href } = {}) {
    if (role === "guest") {
      const back = href || window.location.pathname + window.location.search;
      window.location.assign(`/login?${new URLSearchParams({ next: back })}`);
      return { ok: false, error: null };
    }
    if (!productId || (button && inFlight.has(button))) return { ok: false, error: null };
    if (button) {
      inFlight.add(button);
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
    }
    const flight = Nx.startFlight(source, src);
    try {
      const result = await Nx.api("/api/cart/items", { method: "POST", body: { productId, quantity } });
      await flight.landed;
      Nx.setCartCount(result.cart.summary.count);
      Nx.toast(result.message, "success", { action: { label: "View cart", href: "/cart" } });
      markButton(button, "added");
      return { ok: true, cart: result.cart };
    } catch (error) {
      flight.abort();
      if (error.code === "cart_limit" || error.code === "cart_room") {
        // Not a failure: the shopper already has as many as they can buy.
        Nx.toast(error.message, "info", { action: { label: "View cart", href: "/cart" } });
        if (error.code === "cart_limit") markButton(button, "max");
      } else {
        Nx.toast(error.message, "error");
      }
      return { ok: false, error };
    } finally {
      if (button) {
        inFlight.delete(button);
        button.disabled = false;
        button.removeAttribute("aria-busy");
      }
    }
  };

  // Any [data-cart-add="<product id>"] button adds one to the cart. The photo flies from the card the
  // button sits in; data-cart-src names a different photo, data-cart-from="card" flies the whole card's
  // box (for cards whose photo is on a hidden face), data-cart-href is where a guest returns to.
  document.addEventListener("click", event => {
    const button = event.target.closest("[data-cart-add]");
    if (!button || button.disabled) return;
    event.preventDefault();
    const card = button.closest("[data-cart-card], .product-card, [data-flip-card], .acct-buy-card, li, article");
    const photo = card && card.querySelector("img");
    const source = button.dataset.cartFrom === "card" && card ? card : photo || button;
    const src = button.dataset.cartSrc || (photo ? photo.currentSrc || photo.src : "");
    Nx.addToCart({ productId: button.dataset.cartAdd, source, src, button, href: button.dataset.cartHref });
  });

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
    if (/^(\/|https:\/\/)/.test(p.image || "")) {
      // Same responsive sizes as the server-drawn cards (utils/images.js): Unsplash photos and our own
      // uploads come in several widths and the browser picks the smallest sharp one.
      const srcset = Nx.photoSrcset(p.image);
      if (srcset) {
        img.srcset = srcset;
        img.sizes = "(max-width: 720px) 50vw, (max-width: 1180px) 33vw, 340px";
      }
      img.src = p.image;
    }
    // No "% off" tag on the photo: the discount shows in the price row below.
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
    // Quick add, the same button as partials/product-card.ejs (shoppers and guests, in stock only).
    if ((role === "guest" || role === "customer") && p.stock > 0) {
      const add = document.createElement("button");
      add.type = "button";
      add.className = "card-add";
      add.dataset.cartAdd = p.id;
      add.dataset.cartHref = `/products/${encodeURIComponent(p.slug)}`;
      add.innerHTML = `${iconSvg("cart", "card-add-cart")}${iconSvg("check", "card-add-done")}<span class="sr-only"></span>`;
      add.querySelector(".sr-only").textContent = `Add ${p.name} to cart`;
      card.querySelector(".product-media").append(add);
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

  // ---------- Wishlist (saved on the server, for signed-in customers) ----------
  // The header carries the saved ids, so every heart on the page starts in the right state.
  let savedIds = [];
  try {
    savedIds = JSON.parse((header && header.dataset.wishIds) || "[]").filter(id => ID.test(id));
  } catch {
    savedIds = [];
  }

  Nx.setWishCount = function setWishCount(count) {
    document.querySelectorAll("[data-wish-count]").forEach(badge => {
      badge.textContent = String(count);
      badge.hidden = count === 0;
      badge.classList.remove("is-bumped");
      void badge.offsetWidth;
      badge.classList.add("is-bumped");
    });
    document.querySelectorAll("[data-wish-link]").forEach(link => {
      link.setAttribute("aria-label", `Wishlist, ${count} ${count === 1 ? "item" : "items"}`);
    });
  };

  function showWishlist() {
    document.querySelectorAll("[data-wish-id]").forEach(button => {
      const saved = savedIds.includes(button.dataset.wishId);
      button.hidden = !shopper;
      button.setAttribute("aria-pressed", String(saved));
      const label = button.querySelector("[data-wish-label]");
      if (label) label.textContent = saved ? "Saved to wishlist" : "Add to wishlist";
    });
  }

  // Server replies carry the whole wishlist; keep the hearts and badge in step with it.
  Nx.applyWishlist = function applyWishlist(wishlist) {
    if (!wishlist) return;
    savedIds = wishlist.items.map(item => item.productId);
    Nx.setWishCount(wishlist.count);
    showWishlist();
  };

  document.addEventListener("click", async event => {
    const button = event.target.closest("[data-wish-id]");
    if (!button) return;
    event.preventDefault();
    // Guests sign in first and come straight back to this page.
    if (role === "guest") {
      const params = new URLSearchParams({ next: window.location.pathname + window.location.search });
      window.location.assign(`/login?${params}`);
      return;
    }
    const id = button.dataset.wishId;
    const saving = !savedIds.includes(id);
    button.disabled = true;
    try {
      const reply = saving
        ? await Nx.api("/api/wishlist", { method: "POST", body: { productId: id } })
        : await Nx.api(`/api/wishlist/${id}`, { method: "DELETE" });
      Nx.applyWishlist(reply.wishlist);
      button.classList.remove("is-popped", "is-bursting");
      void button.offsetWidth;
      button.classList.add("is-popped");
      // Saving bursts a ring of dots out of the heart (motion.css); removing just settles.
      if (saving) {
        button.classList.add("is-bursting");
        button.addEventListener("animationend", event => { if (event.pseudoElement === "::after") button.classList.remove("is-bursting"); });
        setTimeout(() => button.classList.remove("is-bursting"), Nx.motionMs ? Nx.motionMs("--duration-long", 550) + 100 : 650);
      }
      Nx.toast(reply.message);
    } catch (error) {
      Nx.toast(error.message, "error");
    } finally {
      button.disabled = false;
    }
  });

  // Customers who saved items before wishlists moved to their account: bring them across once.
  if (role === "customer") {
    const old = readIds(WISH_KEY);
    if (old.length) {
      (async () => {
        let latest = null;
        for (const productId of old.slice(0, WISH_MAX)) {
          try {
            latest = (await Nx.api("/api/wishlist", { method: "POST", body: { productId } })).wishlist;
          } catch {
            /* no longer sold: skip it */
          }
        }
        try {
          localStorage.removeItem(WISH_KEY);
        } catch {
          /* storage blocked */
        }
        if (latest) Nx.applyWishlist(latest);
      })();
    }
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
