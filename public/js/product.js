// Product page: full-screen photos, delivery date by PIN code, and sharing.
(function () {
  "use strict";

  // ---------- Full-screen photo viewer (a <dialog>: focus stays inside, Escape closes it) ----------
  const lightbox = document.querySelector("[data-lightbox]");
  const opener = document.querySelector("[data-lightbox-open]");
  if (lightbox && opener && typeof lightbox.showModal === "function") {
    let photos = [];
    try {
      photos = JSON.parse(lightbox.dataset.photos || "[]");
    } catch {
      photos = [];
    }
    const img = lightbox.querySelector("[data-lightbox-img]");
    const counter = lightbox.querySelector("[data-lightbox-index]");
    const mainPhoto = document.querySelector("[data-gallery-main]");
    let index = 0;

    const show = next => {
      if (!photos.length) return;
      index = (next + photos.length) % photos.length;
      img.src = photos[index];
      if (counter) counter.textContent = String(index + 1);
    };
    const open = () => {
      const current = mainPhoto ? photos.indexOf(mainPhoto.getAttribute("src")) : 0;
      show(Math.max(0, current));
      lightbox.showModal();
      document.body.classList.add("drawer-open");
    };

    opener.addEventListener("click", open);
    // Clicking the photo stage opens the viewer too (the WebGL canvas sits over the photo).
    const stage = document.querySelector("[data-stage]");
    if (stage) {
      stage.addEventListener("click", event => {
        if (!event.target.closest("button, a")) open();
      });
    }
    lightbox.addEventListener("close", () => document.body.classList.remove("drawer-open"));
    lightbox.querySelector("[data-lightbox-close]").addEventListener("click", () => lightbox.close());
    lightbox.querySelectorAll("[data-lightbox-step]").forEach(button => {
      button.addEventListener("click", () => show(index + Number(button.dataset.lightboxStep)));
    });
    lightbox.addEventListener("keydown", event => {
      if (event.key === "ArrowRight") show(index + 1);
      if (event.key === "ArrowLeft") show(index - 1);
    });
    lightbox.addEventListener("click", event => {
      if (event.target === lightbox || event.target.classList.contains("lightbox-stage")) lightbox.close();
    });
    // Swipe between photos.
    let startX = null;
    img.addEventListener("pointerdown", event => { startX = event.clientX; });
    img.addEventListener("pointerup", event => {
      if (startX === null) return;
      const dx = event.clientX - startX;
      startX = null;
      if (Math.abs(dx) > 50) show(index + (dx < 0 ? 1 : -1));
    });
  }

  // ---------- Delivery date by PIN code ----------
  const delivery = document.querySelector("[data-delivery-check]");
  if (delivery) {
    const input = delivery.querySelector('input[name="pincode"]');
    const result = delivery.querySelector("[data-delivery-result]");
    const check = async pincode => {
      result.className = "delivery-result is-loading";
      result.textContent = "Checking delivery dates…";
      input.removeAttribute("aria-invalid");
      try {
        const { estimate } = await Nx.api(`/api/delivery/estimate?pincode=${encodeURIComponent(pincode)}`);
        result.className = "delivery-result is-ok";
        result.textContent = `Delivery by ${estimate.label} to ${estimate.pincode}.${estimate.orderBy ? ` Order before ${estimate.orderBy}.` : ""}`;
        try {
          localStorage.setItem("nx-pincode", estimate.pincode);
        } catch {
          /* not saved; fine */
        }
      } catch (error) {
        result.className = "delivery-result is-error";
        result.textContent = error.message;
        input.setAttribute("aria-invalid", "true");
      }
    };
    delivery.addEventListener("submit", event => {
      event.preventDefault();
      const pincode = input.value.trim();
      if (!/^[1-9][0-9]{5}$/.test(pincode)) {
        result.className = "delivery-result is-error";
        result.textContent = "Enter a valid 6-digit PIN code.";
        input.setAttribute("aria-invalid", "true");
        input.focus();
        return;
      }
      check(pincode);
    });
    // Show the estimate straight away for the PIN code used last time.
    try {
      const saved = localStorage.getItem("nx-pincode");
      if (saved && /^[1-9][0-9]{5}$/.test(saved)) {
        input.value = saved;
        check(saved);
      }
    } catch {
      /* storage blocked */
    }
  }

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

  // ---------- Title: each word rises into place ----------
  const title = document.querySelector("[data-split]");
  if (title && !reducedMotion) {
    const words = title.textContent.trim().split(/\s+/);
    title.setAttribute("aria-label", title.textContent.trim());
    title.textContent = "";
    words.forEach((word, i) => {
      const outer = document.createElement("span");
      outer.className = "w";
      outer.setAttribute("aria-hidden", "true");
      outer.style.setProperty("--i", String(i));
      const inner = document.createElement("span");
      inner.textContent = word;
      outer.append(inner);
      title.append(outer, document.createTextNode(" "));
    });
  }

  // ---------- Price counts up once ----------
  const price = document.querySelector("[data-price-count]");
  if (price && !reducedMotion && window.Nx && Nx.formatPrice && window.NxTicker) {
    const target = Number(price.dataset.priceCount) || 0;
    const final = price.textContent;
    let t = 0;
    const stop = NxTicker.add((time, dt) => {
      t = Math.min(1, t + dt / 1.2);
      const eased = 1 - Math.pow(1 - t, 4);
      price.textContent = t >= 1 ? final : Nx.formatPrice(Math.round((target * eased) / 100) * 100);
      if (t >= 1) stop();
    });
    // The loop pauses in a hidden tab, so always land on the real price.
    setTimeout(() => { stop(); price.textContent = final; }, 1600);
  }

  // ---------- Magnetic buttons ----------
  if (finePointer && !reducedMotion) {
    document.querySelectorAll("[data-magnetic]").forEach(button => {
      button.addEventListener("pointermove", event => {
        const box = button.getBoundingClientRect();
        const x = (event.clientX - box.left - box.width / 2) * 0.18;
        const y = (event.clientY - box.top - box.height / 2) * 0.3;
        button.style.transform = `translate(${x}px, ${y}px)`;
      });
      button.addEventListener("pointerleave", () => { button.style.transform = ""; });
    });

    // ---------- Feature cards tilt and light up under the cursor ----------
    document.querySelectorAll("[data-tilt]").forEach(card => {
      card.addEventListener("pointermove", event => {
        const box = card.getBoundingClientRect();
        const px = (event.clientX - box.left) / box.width;
        const py = (event.clientY - box.top) / box.height;
        card.style.setProperty("--mx", `${px * 100}%`);
        card.style.setProperty("--my", `${py * 100}%`);
        card.style.setProperty("--ry", `${(px - 0.5) * 8}deg`);
        card.style.setProperty("--rx", `${(0.5 - py) * 8}deg`);
      });
      card.addEventListener("pointerleave", () => {
        card.style.setProperty("--rx", "0deg");
        card.style.setProperty("--ry", "0deg");
      });
    });
  }

  // ---------- Sticky buy dock: shows once the main buy panel has scrolled away ----------
  const dock = document.querySelector("[data-dock]");
  const buyPanel = document.getElementById("buy");
  if (dock && buyPanel && "IntersectionObserver" in window) {
    const setDock = on => {
      dock.classList.toggle("is-on", on);
      dock.setAttribute("aria-hidden", String(!on));
      dock.querySelectorAll("a, button").forEach(el => { el.tabIndex = on ? 0 : -1; });
    };
    new IntersectionObserver(([entry]) => {
      // Only when the panel is above the viewport (scrolled past), not before it.
      setDock(!entry.isIntersecting && entry.boundingClientRect.top < 0);
    }, { threshold: 0 }).observe(buyPanel);
  }

  // ---------- Add to cart / Buy now ----------
  const orderForm = document.querySelector("[data-add-to-cart]");
  const dockCart = document.querySelector("[data-dock-cart]");
  if (dockCart && orderForm) {
    dockCart.addEventListener("click", () => orderForm.requestSubmit());
  }

  // Buy now puts exactly the chosen quantity of this product in the cart (adding it, or
  // setting the quantity if it is already there) and goes straight to checkout.
  document.querySelectorAll("[data-buy-now]").forEach(button => {
    button.addEventListener("click", async () => {
      if (!orderForm) return;
      const productId = orderForm.dataset.productId;
      const input = orderForm.querySelector("[data-qty-input]");
      const quantity = Math.max(1, Math.round(Number(input && input.value)) || 1);
      Nx.busy(button, true, "Going to checkout…");
      try {
        const { cart } = await Nx.api("/api/cart");
        const inCart = cart && cart.items && cart.items.some(item => String(item.productId) === String(productId));
        if (inCart) {
          await Nx.api(`/api/cart/items/${encodeURIComponent(productId)}`, { method: "PATCH", body: { quantity } });
        } else {
          await Nx.api("/api/cart/items", { method: "POST", body: { productId, quantity } });
        }
        window.location.href = "/checkout";
      } catch (error) {
        Nx.busy(button, false);
        Nx.toast(error.message, "error");
      }
    });
  });

  // ---------- Reviews ----------
  const reviewsBox = document.querySelector("[data-reviews]");
  if (reviewsBox) {
    const productId = reviewsBox.dataset.productId;
    const list = reviewsBox.querySelector("[data-review-list]");
    const empty = reviewsBox.querySelector("[data-review-empty]");
    const more = reviewsBox.querySelector("[data-review-more]");
    let page = Number(reviewsBox.dataset.page) || 1;
    let pages = Number(reviewsBox.dataset.pages) || 1;

    const svgIcon = (name, cls) => {
      const ns = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(ns, "svg");
      svg.setAttribute("class", `i ${cls || ""}`);
      svg.setAttribute("aria-hidden", "true");
      const use = document.createElementNS(ns, "use");
      use.setAttribute("href", `/img/icons.svg#${name}`);
      svg.append(use);
      return svg;
    };
    const el = (tag, cls, text) => {
      const node = document.createElement(tag);
      if (cls) node.className = cls;
      if (text != null) node.textContent = text;
      return node;
    };
    const fmtDate = value => new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

    // Same markup as the server-rendered reviews in views/pages/product.ejs.
    const renderReview = review => {
      const item = el("li", "pdx-review");
      const top = el("div", "pdx-review-top");
      const avatar = el("span", "pdx-avatar", (review.author || "?").charAt(0).toUpperCase());
      avatar.setAttribute("aria-hidden", "true");
      const who = el("div", "pdx-review-who");
      who.append(el("strong", "", review.author));
      const meta = el("span", "", fmtDate(review.createdAt));
      if (review.verified) {
        const badge = el("span", "pdx-verified");
        badge.append(svgIcon("check", "i-xs"), " Verified purchase");
        meta.append(" · ", badge);
      }
      who.append(meta);
      const stars = el("span", "rating");
      stars.style.setProperty("--rating", String(review.rating));
      stars.setAttribute("role", "img");
      stars.setAttribute("aria-label", `${review.rating} out of 5 stars`);
      top.append(avatar, who, stars);
      item.append(top);
      if (review.title) item.append(el("h3", "pdx-review-title", review.title));
      item.append(el("p", "pdx-review-body", review.body));
      return item;
    };

    // Average, stars, count and the 5-to-1 bars, from a fresh reviews listing.
    const renderSummary = data => {
      const total = data.pagination.total;
      const average = total ? data.breakdown.reduce((sum, row) => sum + row.stars * row.count, 0) / total : 0;
      const avgEl = reviewsBox.querySelector("[data-review-average]");
      if (avgEl) avgEl.textContent = total ? (Math.round(average * 10) / 10).toFixed(1) : "–";
      const starsEl = reviewsBox.querySelector("[data-review-stars]");
      if (starsEl) starsEl.style.setProperty("--rating", String(average));
      const countEl = reviewsBox.querySelector("[data-review-count]");
      if (countEl) countEl.textContent = `${total} ${total === 1 ? "review" : "reviews"}`;
      const maxBar = Math.max(1, ...data.breakdown.map(row => row.count));
      data.breakdown.forEach(row => {
        const li = reviewsBox.querySelector(`[data-review-bars] [data-stars="${row.stars}"]`);
        if (!li) return;
        li.querySelector(".pdx-bar i").style.width = `${Math.round((row.count / maxBar) * 100)}%`;
        li.querySelector(".pdx-bar-n").textContent = String(row.count);
      });
      if (empty) empty.hidden = total > 0;
      pages = data.pagination.pages;
    };

    // "Show more reviews"
    if (more) {
      more.addEventListener("click", async () => {
        Nx.busy(more, true, "Loading…");
        try {
          const data = await Nx.api(`/api/products/${encodeURIComponent(productId)}/reviews?page=${page + 1}`);
          page = data.pagination.page;
          pages = data.pagination.pages;
          data.reviews.forEach(review => list.append(renderReview(review)));
          Nx.busy(more, false);
          more.hidden = page >= pages;
        } catch (error) {
          Nx.busy(more, false);
          Nx.toast(error.message, "error");
        }
      });
    }

    // Write a review
    const form = reviewsBox.querySelector("[data-review-form]");
    if (form) {
      const words = ["", "Poor", "Fair", "Good", "Very good", "Excellent"];
      const word = form.querySelector("[data-star-word]");
      const errorBox = form.querySelector("[data-review-error]");
      const body = form.querySelector("[data-review-body]");
      const chars = form.querySelector("[data-review-chars]");
      const showError = message => {
        errorBox.textContent = message;
        errorBox.hidden = !message;
      };

      form.querySelectorAll('input[name="rating"]').forEach(radio => {
        radio.addEventListener("change", () => {
          word.textContent = `${radio.value} / 5 · ${words[Number(radio.value)]}`;
          word.classList.add("is-set");
          showError("");
        });
      });
      body.addEventListener("input", () => {
        chars.textContent = String(body.value.length);
        body.removeAttribute("aria-invalid");
      });

      form.addEventListener("submit", async event => {
        event.preventDefault();
        const picked = form.querySelector('input[name="rating"]:checked');
        const text = body.value.trim();
        if (!picked) {
          showError("Choose from 1 to 5 stars.");
          return;
        }
        if (text.length < 10) {
          body.setAttribute("aria-invalid", "true");
          body.focus();
          showError("Write a review of at least 10 characters.");
          return;
        }
        showError("");
        const button = form.querySelector('[type="submit"]');
        Nx.busy(button, true, "Posting…");
        try {
          const result = await Nx.api(`/api/products/${encodeURIComponent(productId)}/reviews`, {
            method: "POST",
            body: { rating: Number(picked.value), title: form.elements.title.value.trim(), body: text }
          });
          const item = renderReview(result.review);
          item.classList.add("is-new");
          list.prepend(item);
          // One review per customer: swap the form for a note.
          const note = el("div", "pdx-review-note");
          const span = el("span", "", "Thanks! Your review is live. ");
          const link = el("a", "", "Edit or delete it in My Account");
          link.href = "/account/reviews";
          span.append(link, ".");
          note.append(svgIcon("check", "i-sm"), span);
          form.replaceWith(note);
          Nx.toast(result.message || "Thanks! Your review is live.");
          try {
            renderSummary(await Nx.api(`/api/products/${encodeURIComponent(productId)}/reviews?page=1`));
          } catch {
            /* the summary catches up on the next visit */
          }
        } catch (error) {
          Nx.busy(button, false);
          showError(error.message);
        }
      });
    }
  }

  // ---------- Share ----------
  document.querySelectorAll("[data-share]").forEach(button => {
    button.addEventListener("click", async () => {
      const url = window.location.origin + window.location.pathname;
      const title = button.dataset.shareTitle || document.title;
      if (navigator.share) {
        try {
          await navigator.share({ title, url });
        } catch {
          /* the shopper closed the share sheet */
        }
        return;
      }
      try {
        await navigator.clipboard.writeText(url);
        Nx.toast("Link copied. Paste it anywhere to share.");
      } catch {
        window.prompt("Copy this link to share:", url);
      }
    });
  });
})();
