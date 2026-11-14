// Product page: real photo zoom (hover magnifier and a full-screen viewer), delivery date by PIN code, and sharing.
(function () {
  "use strict";

  // A sharper copy of a photo for zooming: Unsplash serves any width (w=2000); our own uploads are
  // stored at up to 2000px already, so they are used as they are.
  // The page shows one of our own photos as a smaller copy (".../<id>-1600.webp"); zooming wants the full-size
  // one (".../<id>-full.webp"), which is also what the photo list holds.
  const fullOf = src => (src || "").replace(/(\/products\/[a-f0-9]{32})-\d+\.webp$/, "$1-full.webp");
  const hiRes = src => (/^https:\/\/images\.unsplash\.com\//.test(src || "") && /([?&])w=\d+/.test(src) ? src.replace(/([?&])w=\d+/, "$1w=2000") : fullOf(src));
  const mouseZoom = window.matchMedia("(hover: hover) and (pointer: fine)");
  const mainPhoto = document.querySelector("[data-gallery-main]");
  const stage = document.querySelector("[data-zoom-stage]");

  // ---------- Hover magnifier (mouse) ----------
  // Two columns: a lens over the photo and the magnified spot in a panel beside it (Amazon-style).
  // One column: the photo itself zooms in place under the pointer.
  if (stage && mainPhoto) {
    const lens = stage.querySelector("[data-zoom-lens]");
    const pane = document.querySelector("[data-zoom-pane]");
    const ZOOM = 2.5;
    let active = false;

    // A quick fade while the next photo loads; the zoom copy is fetched ahead, so it is ready.
    new MutationObserver(() => {
      stage.classList.add("is-switching");
      const done = () => stage.classList.remove("is-switching");
      if (mainPhoto.complete) requestAnimationFrame(done);
      else mainPhoto.addEventListener("load", done, { once: true });
      if (active) start();
    }).observe(mainPhoto, { attributes: true, attributeFilter: ["src"] });

    const sideBySide = () => pane && stage.closest(".pdx-grid") && getComputedStyle(stage.closest(".pdx-grid")).gridTemplateColumns.split(" ").length > 1;

    const start = () => {
      const src = hiRes(mainPhoto.getAttribute("src"));
      const box = stage.getBoundingClientRect();
      stage.style.setProperty("--lens-w", `${100 / ZOOM}%`);
      stage.style.setProperty("--lens-h", `${100 / ZOOM}%`);
      if (sideBySide()) {
        stage.classList.remove("is-inplace");
        pane.style.setProperty("--zoom-src", `url("${src.replace(/"/g, "%22")}")`);
        pane.style.setProperty("--zoom-size", `${ZOOM * 100}%`);
        pane.style.setProperty("--zoom-w", `${Math.round(box.width)}px`);
        pane.hidden = false;
        lens.hidden = false;
      } else {
        stage.classList.add("is-inplace");
        pane.hidden = true;
        lens.hidden = true;
      }
      // Load the sharp copy in the background; the panel shows it as soon as it arrives.
      const sharp = new Image();
      sharp.src = src;
    };
    const move = event => {
      const box = stage.getBoundingClientRect();
      // Pointer position as 0..1 inside the photo, with the lens kept inside the edges.
      const half = 0.5 / ZOOM;
      const x = Math.min(1 - half, Math.max(half, (event.clientX - box.left) / box.width));
      const y = Math.min(1 - half, Math.max(half, (event.clientY - box.top) / box.height));
      const posX = ((x - half) / (1 - 2 * half)) * 100;
      const posY = ((y - half) / (1 - 2 * half)) * 100;
      stage.style.setProperty("--lens-x", `${(x - half) * box.width}px`);
      stage.style.setProperty("--lens-y", `${(y - half) * box.height}px`);
      if (pane) pane.style.setProperty("--zoom-pos", `${posX}% ${posY}%`);
      stage.style.setProperty("--zoom-pos", `${x * 100}% ${y * 100}%`);
    };
    const stop = () => {
      active = false;
      stage.classList.remove("is-zooming", "is-inplace");
      if (pane) pane.hidden = true;
      if (lens) lens.hidden = true;
    };

    stage.addEventListener("pointerenter", event => {
      if (event.pointerType !== "mouse" || !mouseZoom.matches) return;
      active = true;
      stage.classList.add("is-zooming");
      start();
      move(event);
    });
    stage.addEventListener("pointermove", event => {
      if (!active) return;
      // Over the share / full-screen / arrow buttons, pause the zoom so they are easy to use.
      if (event.target.closest("button, a")) {
        if (pane) pane.hidden = true;
        lens.hidden = true;
        stage.classList.remove("is-inplace");
        return;
      }
      if ((pane && pane.hidden && sideBySide()) || (!sideBySide() && !stage.classList.contains("is-inplace"))) start();
      move(event);
    });
    stage.addEventListener("pointerleave", stop);
    window.addEventListener("scroll", () => { if (active) stop(); }, { passive: true });
  }

  // ---------- Full-screen viewer, with real zoom (a <dialog>: focus stays inside, Escape closes it) ----------
  // Zoom: double-click / double-tap, pinch, the mouse wheel, or + and -. Drag to look around.
  // At normal size, swipe or the arrows change photo.
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
    const stageBox = lightbox.querySelector(".lightbox-stage");
    const MAX = 4;
    let index = 0;
    let scale = 1;
    let tx = 0;
    let ty = 0;

    const paint = () => {
      img.style.transform = scale === 1 ? "" : `translate(${tx}px, ${ty}px) scale(${scale})`;
      lightbox.classList.toggle("is-zoomed", scale > 1);
    };
    // Keep the zoomed photo covering its frame: no dragging it off into empty space.
    const clampPan = () => {
      const w = img.offsetWidth;
      const h = img.offsetHeight;
      const maxX = (w * scale - w) / 2;
      const maxY = (h * scale - h) / 2;
      tx = Math.max(-maxX, Math.min(maxX, tx));
      ty = Math.max(-maxY, Math.min(maxY, ty));
    };
    // Zoom to a new scale, keeping the point under (clientX, clientY) where it is.
    const zoomTo = (next, clientX, clientY) => {
      const target = Math.max(1, Math.min(MAX, next));
      const box = img.getBoundingClientRect();
      const cx = clientX === undefined ? box.left + box.width / 2 : clientX;
      const cy = clientY === undefined ? box.top + box.height / 2 : clientY;
      // The point relative to the image centre, in unscaled pixels.
      const px = (cx - (box.left + box.width / 2)) / scale;
      const py = (cy - (box.top + box.height / 2)) / scale;
      tx -= px * (target - scale);
      ty -= py * (target - scale);
      scale = target;
      if (scale === 1) {
        tx = 0;
        ty = 0;
      }
      clampPan();
      paint();
    };
    const reset = () => {
      scale = 1;
      tx = 0;
      ty = 0;
      paint();
    };

    const show = next => {
      if (!photos.length) return;
      index = (next + photos.length) % photos.length;
      reset();
      img.src = hiRes(photos[index]);
      if (counter) counter.textContent = String(index + 1);
    };
    const open = () => {
      const current = mainPhoto ? photos.indexOf(fullOf(mainPhoto.getAttribute("src"))) : 0;
      show(Math.max(0, current));
      lightbox.showModal();
      document.body.classList.add("drawer-open");
    };

    opener.addEventListener("click", open);
    // Clicking or tapping the photo opens the viewer too.
    if (stage) {
      stage.addEventListener("click", event => {
        if (!event.target.closest("button, a")) open();
      });
    }
    lightbox.addEventListener("close", () => {
      reset();
      document.body.classList.remove("drawer-open");
    });
    lightbox.querySelector("[data-lightbox-close]").addEventListener("click", () => lightbox.close());
    lightbox.querySelectorAll("[data-lightbox-step]").forEach(button => {
      button.addEventListener("click", () => show(index + Number(button.dataset.lightboxStep)));
    });
    lightbox.addEventListener("keydown", event => {
      if (event.key === "ArrowRight" && scale === 1) show(index + 1);
      if (event.key === "ArrowLeft" && scale === 1) show(index - 1);
      if (event.key === "+" || event.key === "=") zoomTo(scale * 1.5);
      if (event.key === "-") zoomTo(scale / 1.5);
      if (event.key === "0") reset();
    });
    lightbox.addEventListener("click", event => {
      if (scale === 1 && (event.target === lightbox || event.target === stageBox)) lightbox.close();
    });

    // Mouse wheel zooms around the pointer.
    stageBox.addEventListener("wheel", event => {
      event.preventDefault();
      zoomTo(scale * (event.deltaY < 0 ? 1.2 : 1 / 1.2), event.clientX, event.clientY);
    }, { passive: false });
    // Double-click (mouse) zooms in on that spot, or back out.
    img.addEventListener("dblclick", event => {
      zoomTo(scale > 1 ? 1 : 2.5, event.clientX, event.clientY);
    });

    // Touch and pen: pinch to zoom, drag to pan, double-tap to zoom, swipe to change photo.
    const pointers = new Map();
    let pinchStart = null;
    let dragStart = null;
    let lastTap = 0;
    img.addEventListener("pointerdown", event => {
      // Keep receiving this finger even if it slides off the photo (harmless if the browser refuses).
      try { img.setPointerCapture(event.pointerId); } catch { /* not capturable: still works */ }
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchStart = { distance: Math.hypot(a.x - b.x, a.y - b.y), scale, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
        dragStart = null;
      } else {
        dragStart = { x: event.clientX, y: event.clientY, tx, ty, moved: false };
      }
    });
    img.addEventListener("pointermove", event => {
      if (!pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pinchStart && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        zoomTo(pinchStart.scale * (distance / pinchStart.distance), pinchStart.mid.x, pinchStart.mid.y);
      } else if (dragStart) {
        const dx = event.clientX - dragStart.x;
        const dy = event.clientY - dragStart.y;
        if (Math.abs(dx) + Math.abs(dy) > 6) dragStart.moved = true;
        if (scale > 1) {
          tx = dragStart.tx + dx;
          ty = dragStart.ty + dy;
          clampPan();
          paint();
        }
      }
    });
    const end = event => {
      if (!pointers.has(event.pointerId)) return;
      pointers.delete(event.pointerId);
      if (pointers.size < 2) pinchStart = null;
      if (!dragStart || pointers.size) return;
      const dx = event.clientX - dragStart.x;
      if (scale === 1 && Math.abs(dx) > 50) {
        show(index + (dx < 0 ? 1 : -1));
      } else if (!dragStart.moved && event.pointerType !== "mouse") {
        // Double-tap (touch) zooms in on that spot, or back out.
        const now = Date.now();
        if (now - lastTap < 300) {
          zoomTo(scale > 1 ? 1 : 2.5, event.clientX, event.clientY);
          lastTap = 0;
        } else {
          lastTap = now;
        }
      }
      dragStart = null;
    };
    img.addEventListener("pointerup", end);
    img.addEventListener("pointercancel", end);
  }

  // ---------- Delivery (Amazon-style): date, live cut-off countdown, deliverable or not ----------
  const shipBox = document.querySelector("[data-delivery]");
  if (shipBox) {
    const form = shipBox.querySelector("[data-delivery-check]");
    const input = form.querySelector('input[name="pincode"]');
    const result = shipBox.querySelector("[data-delivery-result]");
    const eta = shipBox.querySelector("[data-eta]");
    const countdown = shipBox.querySelector("[data-countdown]");
    const deliverTo = shipBox.querySelector("[data-deliver-to]");
    const shipName = shipBox.querySelector("[data-ship-name]");
    const shipPlace = shipBox.querySelector("[data-ship-place]");
    const free = shipBox.dataset.free === "1";
    const fee = Number(shipBox.dataset.fee) || 0;
    const savedName = shipName.textContent.trim();
    const savedPlace = shipPlace.textContent.trim();
    const savedPin = shipBox.dataset.savedPin || "";
    const validPin = pin => /^[1-9][0-9]{5}$/.test(pin);
    let timer = 0;

    const node = (tag, cls, text) => {
      const el = document.createElement(tag);
      if (cls) el.className = cls;
      if (text != null) el.textContent = text;
      return el;
    };
    const setResult = (message, kind) => {
      result.textContent = message || "";
      result.className = `delivery-result${kind ? ` is-${kind}` : ""}`;
      result.hidden = !message;
    };
    const showForm = on => {
      form.hidden = !on;
      deliverTo.hidden = on;
      if (on) {
        input.focus();
        input.select();
      }
    };
    // "Order within 2 hrs 14 mins" until today's 2 pm cut-off; then the dates move a day.
    const startCountdown = (cutoffAt, pin) => {
      clearInterval(timer);
      countdown.hidden = true;
      if (!cutoffAt) return;
      const end = new Date(cutoffAt).getTime();
      const paint = () => {
        const left = end - Date.now();
        if (left <= 0) {
          clearInterval(timer);
          check(pin);
          return;
        }
        const hours = Math.floor(left / 3600000);
        const mins = Math.max(1, Math.ceil((left % 3600000) / 60000));
        const parts = [];
        if (hours) parts.push(`${hours} hr${hours > 1 ? "s" : ""}`);
        parts.push(`${mins} min${mins > 1 ? "s" : ""}`);
        countdown.replaceChildren("Order within ", node("strong", "", parts.join(" ")), " to get it by then.");
        countdown.hidden = false;
      };
      paint();
      timer = setInterval(paint, 30000);
    };

    async function check(pin) {
      eta.replaceChildren(node("span", "pdx-eta-muted", "Checking delivery dates…"));
      setResult("");
      input.removeAttribute("aria-invalid");
      try {
        const { estimate } = await Nx.api(`/api/delivery/estimate?pincode=${encodeURIComponent(pin)}`);
        // "Deliver to Asha – Bengaluru 560001" for the saved address, "Deliver to 560001" otherwise.
        const usingSaved = pin === savedPin && savedName;
        shipName.textContent = usingSaved ? savedName : "";
        shipPlace.textContent = usingSaved ? savedPlace : pin;
        showForm(false);

        if (!estimate.deliverable) {
          clearInterval(timer);
          countdown.hidden = true;
          eta.replaceChildren(node("strong", "pdx-eta-no", `Not deliverable to ${pin}`));
          setResult(estimate.reason, "error");
          return;
        }
        const lead = free ? node("span", "is-free", "FREE delivery ") : `Delivery ${Nx.formatPrice(fee)} · `;
        eta.replaceChildren(lead, node("strong", "", estimate.label));
        startCountdown(estimate.cutoffAt, pin);
        try {
          localStorage.setItem("nx-pincode", estimate.pincode);
        } catch {
          /* not saved; fine */
        }
      } catch (error) {
        eta.replaceChildren(node("span", "pdx-eta-muted", "Add your PIN code for the exact delivery date."));
        showForm(true);
        setResult(error.message, "error");
        input.setAttribute("aria-invalid", "true");
      }
    }

    form.addEventListener("submit", event => {
      event.preventDefault();
      const pin = input.value.trim();
      if (!validPin(pin)) {
        setResult("Enter a valid 6-digit PIN code.", "error");
        input.setAttribute("aria-invalid", "true");
        input.focus();
        return;
      }
      check(pin);
    });
    shipBox.querySelector("[data-change-pin]").addEventListener("click", () => showForm(true));

    // Start with the customer's saved address, else the PIN code used last time.
    let first = savedPin;
    if (!validPin(first)) {
      try {
        first = localStorage.getItem("nx-pincode") || "";
      } catch {
        first = "";
      }
    }
    if (validPin(first)) {
      input.value = first;
      check(first);
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

  // After Add to cart: "N already in your cart · Go to cart", and the button says "Added" for a moment.
  const inCartBox = document.querySelector("[data-in-cart]");
  if (orderForm) {
    orderForm.addEventListener("nx:cart-added", event => {
      const cart = event.detail || {};
      // Every size of this product together.
      const lines = (cart.items || []).filter(item => String(item.productId) === String(orderForm.dataset.productId));
      const total = lines.reduce((sum, item) => sum + item.quantity, 0);
      if (inCartBox && total) {
        inCartBox.querySelector("[data-in-cart-qty]").textContent = String(total);
        inCartBox.hidden = false;
        inCartBox.classList.remove("is-bump");
        void inCartBox.offsetWidth;
        inCartBox.classList.add("is-bump");
      }
      const button = orderForm.querySelector('[type="submit"]');
      const label = orderForm.querySelector("[data-cart-label]");
      if (button && label) {
        label.textContent = "Added ✓";
        button.classList.add("is-added");
        setTimeout(() => {
          label.textContent = "Add to cart";
          button.classList.remove("is-added");
        }, 2000);
      }
    });
  }

  // Buy now (Amazon-style): a checkout for this one product only. The cart is never touched,
  // so whatever is already in it stays there. Payment works exactly like the cart checkout.
  const buyNow = async button => {
    if (!orderForm) return;
    const variantId = orderForm.nxRequireOption ? orderForm.nxRequireOption() : null;
    if (orderForm.hasAttribute("data-has-options") && !variantId) return;
    // Signed out: sign in, come back with the same size, and carry straight on to checkout.
    if (Nx.shopperRole === "guest") return Nx.signInFirst(orderForm.nxReturnPath({ buy: "now" }));
    if (Nx.shopperRole !== "customer") return;
    const input = orderForm.querySelector("[data-qty-input]");
    const quantity = Math.max(1, Math.round(Number(input && input.value)) || 1);
    if (button) Nx.busy(button, true, "Going to checkout…");
    try {
      const body = { productId: orderForm.dataset.productId, quantity };
      if (variantId) body.variantId = variantId;
      const { redirect } = await Nx.api("/api/buy-now", { method: "POST", body });
      window.location.href = redirect || "/checkout?buy=now";
    } catch (error) {
      if (button) Nx.busy(button, false);
      Nx.toast(error.message, "error");
    }
  };
  document.querySelectorAll("[data-buy-now]").forEach(button => {
    button.addEventListener("click", () => buyNow(button));
  });

  // A guest who clicked Buy now signs in and comes back with ?buy=now: carry on straight to checkout.
  const params = new URLSearchParams(window.location.search);
  if (params.get("buy") === "now") {
    params.delete("buy");
    const clean = window.location.pathname + (params.toString() ? `?${params}` : "") + window.location.hash;
    window.history.replaceState(null, "", clean);
    if (orderForm) buyNow(document.querySelector(".pdx-ctas [data-buy-now]"));
  }

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
      if (review.photos && review.photos.length) {
        const strip = el("div", "pdx-review-photos");
        review.photos.forEach((src, i) => {
          const link = el("a");
          link.href = src;
          link.target = "_blank";
          link.rel = "noopener";
          const img = el("img");
          img.src = src;
          img.alt = `Photo ${i + 1} from ${review.author}`;
          img.width = 88;
          img.height = 88;
          link.append(img);
          strip.append(link);
        });
        item.append(strip);
      }
      if (review.mine) {
        const remove = el("button", "pdx-review-delete");
        remove.type = "button";
        remove.dataset.reviewDelete = review.id;
        remove.append(svgIcon("trash", "i-xs"), " Delete my review");
        item.append(remove);
      }
      return item;
    };

    // Delete my review: only on the customer's own reviews (the server checks it is theirs too).
    list.addEventListener("click", async event => {
      const button = event.target.closest("[data-review-delete]");
      if (!button) return;
      const ok = await Nx.confirm({ title: "Delete this review?", message: "It will be removed from this product page.", confirmLabel: "Delete review" });
      if (!ok) return;
      Nx.busy(button, true, "Deleting…");
      try {
        await Nx.api(`/api/account/reviews/${encodeURIComponent(button.dataset.reviewDelete)}`, { method: "DELETE" });
        button.closest(".pdx-review").remove();
        Nx.toast("Review deleted.");
        // A slot is free again: if the form was gone (5 reviews), reload to bring it back.
        if (!reviewsBox.querySelector("[data-review-form]")) {
          window.location.reload();
          return;
        }
        const form = reviewsBox.querySelector("[data-review-form]");
        form.dataset.reviewsLeft = String((Number(form.dataset.reviewsLeft) || 0) + 1);
        renderSummary(await Nx.api(`/api/products/${encodeURIComponent(productId)}/reviews?page=1`));
      } catch (error) {
        Nx.busy(button, false);
        Nx.toast(error.message, "error");
      }
    });

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
        li.querySelector(".pdx-bar i").style.setProperty("--share", (maxBar ? row.count / maxBar : 0).toFixed(3));
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
      // Photos: small previews, at most 3, 2 MB each (the server checks again).
      const photoInput = form.querySelector("[data-review-photos]");
      const previews = form.querySelector("[data-review-previews]");
      if (photoInput) {
        photoInput.addEventListener("change", () => {
          previews.replaceChildren();
          const files = [...photoInput.files];
          if (files.length > 3) showError("You can add up to 3 photos. The first 3 will be used.");
          else if (files.some(file => file.size > 2 * 1024 * 1024)) showError("Each photo must be 2 MB or smaller.");
          else showError("");
          files.slice(0, 3).forEach(file => {
            const img = el("img");
            img.alt = "";
            img.src = URL.createObjectURL(file);
            img.onload = () => URL.revokeObjectURL(img.src);
            previews.append(img);
          });
        });
      }
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
          // With photos the review goes as a form upload (E3); without, as JSON.
          const files = photoInput ? [...photoInput.files].slice(0, 3) : [];
          let payload = { rating: Number(picked.value), title: form.elements.title.value.trim(), body: text };
          if (files.length) {
            const data = new FormData();
            Object.entries(payload).forEach(([key, value]) => data.append(key, String(value)));
            files.forEach(file => data.append("photos", file));
            payload = data;
          }
          const result = await Nx.api(`/api/products/${encodeURIComponent(productId)}/reviews`, { method: "POST", body: payload });
          if (photoInput) { photoInput.value = ""; previews.replaceChildren(); }
          const item = renderReview(result.review);
          item.classList.add("is-new");
          list.prepend(item);
          // Up to 5 reviews per customer per product: clear the form for the next one,
          // or remove it once the 5th is posted.
          const left = (Number(form.dataset.reviewsLeft) || 1) - 1;
          if (left > 0) {
            form.dataset.reviewsLeft = String(left);
            form.reset();
            chars.textContent = "0";
            word.textContent = "Tap a star";
            word.classList.remove("is-set");
            Nx.busy(button, false);
          } else {
            form.remove();
          }
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
  // ---------- Back-in-stock alerts (E3) ----------
  // "Notify me": one email when the product (or the chosen sold-out size) is back. Guests type their email.
  document.querySelectorAll("[data-stock-alert]").forEach(form => {
    form.addEventListener("submit", async event => {
      event.preventDefault();
      const email = form.elements.email;
      if (email && !email.checkValidity()) {
        Nx.showErrors(form, { email: "Enter a valid email address." });
        email.focus();
        return;
      }
      const values = Nx.formValues(form);
      const reply = await Nx.submitForm(form, { url: `/api/products/${encodeURIComponent(form.dataset.stockAlert)}/stock-alerts`, body: values, busyLabel: "Saving…" });
      if (!reply) return;
      const done = form.querySelector("[data-notify-done]");
      const text = form.querySelector("[data-notify-done-text]");
      if (text) text.textContent = reply.message;
      if (done) done.hidden = false;
      const select = form.elements.variantId;
      if (select) {
        const picked = select.options[select.selectedIndex];
        if (picked && !picked.dataset.waiting) { picked.dataset.waiting = ""; picked.textContent += " (alert on)"; }
      } else {
        const fields = form.querySelector("[data-notify-fields]");
        if (fields) fields.hidden = true;
        form.classList.add("is-done");
      }
    });
  });
  // ---------- Questions and answers (E3) ----------
  const qa = document.querySelector("[data-qa]");
  if (qa) {
    const productId = qa.dataset.productId;
    const qaList = qa.querySelector("[data-qa-list]");
    const qaMore = qa.querySelector("[data-qa-more]");
    const canAnswer = qa.hasAttribute("data-can-answer");
    let qaPage = 1;
    const make = (tag, cls, text) => { const node = document.createElement(tag); if (cls) node.className = cls; if (text != null) node.textContent = text; return node; };
    const day = value => new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
    const line = (tag, body, meta) => {
      const p = make("p", tag === "A" ? "pdx-qa-a" : "pdx-qa-q");
      const badge = make("span", tag === "A" ? "pdx-qa-tag is-a" : "pdx-qa-tag", tag);
      badge.setAttribute("aria-hidden", "true");
      const text = make("span");
      text.append(tag === "Q" ? make("strong", "", body) : body, make("small", "muted", meta));
      p.append(badge, text);
      return p;
    };
    // Same markup as views/partials/questions.ejs.
    const renderQuestion = q => {
      const item = make("li", "pdx-qa-item");
      item.dataset.question = q.id;
      item.append(line("Q", q.body, `${q.author} · ${day(q.createdAt)}`));
      q.answers.forEach(a => item.append(line("A", a.body, `${a.author}${a.isStaff ? " · Store answer" : a.verifiedBuyer ? " · Bought it" : ""} · ${day(a.at)}`)));
      if (!q.answers.length) item.append(make("p", "muted pdx-qa-wait", "No answer yet. Buyers and our team usually answer within a day."));
      if (canAnswer && !q.mine) {
        const button = make("button", "pdx-text-btn", "Answer this");
        button.type = "button";
        button.dataset.qaAnswer = "";
        item.append(button);
      }
      return item;
    };

    const askForm = qa.querySelector("[data-qa-ask]");
    if (askForm) {
      askForm.addEventListener("submit", async event => {
        event.preventDefault();
        const body = askForm.elements.body.value.trim();
        if (body.length < 10) { Nx.showErrors(askForm, { body: "Write a question of at least 10 characters." }); return; }
        const reply = await Nx.submitForm(askForm, { url: `/api/products/${encodeURIComponent(productId)}/questions`, body: { body }, busyLabel: "Posting…" });
        if (!reply) return;
        askForm.reset();
        const item = renderQuestion(reply.question);
        item.classList.add("is-new");
        qaList.prepend(item);
        qa.querySelector("[data-qa-empty]").hidden = true;
        Nx.toast(reply.message);
      });
    }

    qaList.addEventListener("click", event => {
      const button = event.target.closest("[data-qa-answer]");
      if (!button) return;
      const item = button.closest("[data-question]");
      const form = make("form", "pdx-qa-ask pdx-qa-reply");
      form.noValidate = true;
      const input = make("textarea");
      input.name = "body";
      input.rows = 2;
      input.maxLength = 1000;
      input.setAttribute("aria-label", "Your answer");
      input.placeholder = "Share what you know from using it";
      const send = make("button", "btn btn-primary btn-sm", "Post answer");
      send.type = "submit";
      const error = make("p", "field-error");
      error.dataset.errorFor = "body";
      form.append(input, send, error);
      button.replaceWith(form);
      input.focus();
      form.addEventListener("submit", async submit => {
        submit.preventDefault();
        const reply = await Nx.submitForm(form, { url: `/api/questions/${encodeURIComponent(item.dataset.question)}/answers`, body: { body: input.value.trim() }, busyLabel: "Posting…" });
        if (!reply) return;
        const fresh = renderQuestion(reply.question);
        fresh.classList.add("is-new");
        item.replaceWith(fresh);
        Nx.toast(reply.message);
      });
    });

    if (qaMore) {
      qaMore.addEventListener("click", async () => {
        Nx.busy(qaMore, true, "Loading…");
        try {
          const data = await Nx.api(`/api/products/${encodeURIComponent(productId)}/questions?page=${qaPage + 1}`);
          qaPage = data.pagination.page;
          data.questions.forEach(q => qaList.append(renderQuestion(q)));
          qaMore.hidden = qaPage >= data.pagination.pages;
        } catch (error) {
          Nx.toast(error.message, "error");
        } finally {
          Nx.busy(qaMore, false);
        }
      });
    }
  }
})();
