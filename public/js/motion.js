// Motion layer: scroll reveals, 3D tilt, glass header, counters, progress bar (and parallax on a .hero, if a page has one).
// Everything here is decoration. If this file fails, the page is still complete and visible:
// content is only hidden while <html> has the "js-motion" class, which this file adds last.
(function () {
  "use strict";

  const root = document.documentElement;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
  const STAGGER_MS = 80;
  const MAX_STAGGER = 10;

  // Password show/hide buttons also use data-reveal (it names their field), so buttons are skipped.
  const revealItems = () => [...document.querySelectorAll("[data-reveal]:not(button):not(.is-revealed)")];

  function revealNow(el) {
    el.classList.add("is-revealed");
    el.setAttribute("data-reveal-done", "");
  }

  // ---------- Scroll reveal ----------
  function setupReveal() {
    const items = revealItems();
    if (!items.length) return;
    if (!("IntersectionObserver" in window)) {
      items.forEach(revealNow);
      return;
    }

    // Anything already on screen is shown straight away, so nothing blinks out after the first paint.
    // Items in a sideways-scrolling row (like the sports row on phones) are shown too: the visitor
    // swipes them into view, and they must never sit there empty.
    const viewHeight = window.innerHeight || root.clientHeight;
    const inSideScroller = el => {
      const parent = el.parentElement;
      return Boolean(parent) && parent.scrollWidth > parent.clientWidth + 1 && /(auto|scroll)/.test(getComputedStyle(parent).overflowX);
    };
    items.forEach(el => {
      const box = el.getBoundingClientRect();
      if ((box.top < viewHeight && box.bottom > 0) || inSideScroller(el)) revealNow(el);
    });

    const observer = new IntersectionObserver(entries => {
      // Items that come into view together are staggered in page order, 80ms apart.
      const visible = entries.filter(entry => entry.isIntersecting).map(entry => entry.target);
      visible.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
      visible.forEach((el, index) => {
        const own = Number.parseInt(el.dataset.revealDelay, 10);
        const delay = Number.isFinite(own) ? own : Math.min(index, MAX_STAGGER) * STAGGER_MS;
        el.style.setProperty("--reveal-delay", `${delay}ms`);
        el.classList.add("is-revealed");
        el.addEventListener("animationend", () => el.setAttribute("data-reveal-done", ""), { once: true });
        observer.unobserve(el);
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });

    items.filter(el => !el.classList.contains("is-revealed")).forEach(el => observer.observe(el));

    // Printing, or switching reduced motion on, shows everything at once.
    const showAll = () => revealItems().forEach(el => { revealNow(el); observer.unobserve(el); });
    window.addEventListener("beforeprint", showAll);
    reduced.addEventListener("change", () => { if (reduced.matches) showAll(); });
  }

  // ---------- 3D tilt + glare ----------
  const MAX_TILT = 8;
  function setupTilt() {
    document.querySelectorAll("[data-tilt]").forEach(card => {
      let frame = 0;
      let glare = null;
      const ensureGlare = () => {
        if (glare) return;
        glare = document.createElement("span");
        glare.className = "tilt-glare";
        glare.setAttribute("aria-hidden", "true");
        card.append(glare);
      };

      card.addEventListener("pointermove", event => {
        // Mouse only: touch screens and reduced motion never tilt.
        if (event.pointerType !== "mouse" || !finePointer.matches || reduced.matches) return;
        ensureGlare();
        const { clientX, clientY } = event;
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          const box = card.getBoundingClientRect();
          const x = (clientX - box.left) / box.width - 0.5;
          const y = (clientY - box.top) / box.height - 0.5;
          card.style.setProperty("--tilt-x", `${(-y * MAX_TILT * 2).toFixed(2)}deg`);
          card.style.setProperty("--tilt-y", `${(x * MAX_TILT * 2).toFixed(2)}deg`);
          // The glare is twice the card's size, centred on it; moving it puts its bright centre under the cursor.
          card.style.setProperty("--glare-x", `${(x * box.width).toFixed(1)}px`);
          card.style.setProperty("--glare-y", `${(y * box.height).toFixed(1)}px`);
          card.classList.add("is-tilting");
        });
      });

      card.addEventListener("pointerleave", () => {
        cancelAnimationFrame(frame);
        card.classList.remove("is-tilting");
        card.style.setProperty("--tilt-x", "0deg");
        card.style.setProperty("--tilt-y", "0deg");
      });
    });
  }

  // ---------- Scroll-driven bits: header glass, progress bar, hero parallax ----------
  function setupScroll() {
    const header = document.querySelector("[data-site-header]");
    const hero = document.querySelector(".hero");

    const bar = document.createElement("div");
    bar.className = "scroll-progress";
    bar.setAttribute("aria-hidden", "true");
    bar.append(document.createElement("span"));
    document.body.append(bar);

    let heroBg = null;
    if (hero) {
      heroBg = document.createElement("div");
      heroBg.className = "hero-bg";
      heroBg.setAttribute("aria-hidden", "true");
      hero.prepend(heroBg);
    }

    let ticking = false;
    const update = () => {
      ticking = false;
      const y = window.scrollY || root.scrollTop;
      if (header) header.classList.toggle("is-scrolled", y > 20);
      const max = root.scrollHeight - window.innerHeight;
      bar.style.setProperty("--progress", max > 0 ? Math.min(1, y / max).toFixed(4) : "0");
      // The hero background moves at 35% of the scroll speed, so it drifts behind the text.
      if (heroBg && !reduced.matches && y < hero.offsetTop + hero.offsetHeight) {
        heroBg.style.translate = `0 ${(y * 0.35).toFixed(1)}px`;
      }
    };
    const onScroll = () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    update();
  }

  // ---------- Counters on the admin dashboard ----------
  function setupCounters() {
    const counters = [...document.querySelectorAll("[data-count-to]")];
    if (!counters.length || reduced.matches || !("IntersectionObserver" in window)) return;
    const run = el => {
      const target = Number(el.dataset.countTo);
      if (!Number.isFinite(target) || target <= 0) return;
      const duration = Math.min(1600, 600 + target * 8);
      const start = performance.now();
      const step = now => {
        const t = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - t, 3);
        el.textContent = String(Math.round(target * eased));
        if (t < 1) requestAnimationFrame(step);
        else el.textContent = String(target);
      };
      requestAnimationFrame(step);
    };
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        observer.unobserve(entry.target);
        run(entry.target);
      });
    }, { threshold: 0.4 });
    counters.forEach(el => observer.observe(el));
  }

  // ---------- Product images fade in when they finish loading ----------
  function setupImages() {
    const selector = ".product-media img, .gallery-main img, .slide-img, .category-media img, .cart-item-media img, .thumb img";
    document.querySelectorAll(selector).forEach(img => {
      if (img.complete && img.naturalWidth) return;
      img.classList.add("is-loading");
      const done = () => {
        img.classList.add("is-loaded");
        img.classList.remove("is-loading");
      };
      img.addEventListener("load", done, { once: true });
      // A broken image must never stay invisible.
      img.addEventListener("error", done, { once: true });
    });
  }

  try {
    setupReveal();
    setupTilt();
    setupScroll();
    setupCounters();
    setupImages();
    root.classList.add("js-motion");
  } catch (error) {
    // Something went wrong: show everything rather than leave anything hidden.
    root.classList.remove("js-motion");
    document.querySelectorAll("img.is-loading").forEach(img => img.classList.remove("is-loading"));
  }
})();
