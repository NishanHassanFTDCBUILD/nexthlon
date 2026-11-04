// Product list filters, the phone filter drawer, and the product photo gallery.
(function () {
  "use strict";

  // While the next page of results loads, show a loading bar over the product grid.
  const results = document.querySelector("[data-results]");
  function showLoading() {
    if (!results) return;
    results.classList.add("is-loading");
    results.setAttribute("aria-busy", "true");
  }
  // Coming back with the browser's back button restores the page from cache; clear the loading look.
  window.addEventListener("pageshow", () => {
    if (!results) return;
    results.classList.remove("is-loading");
    results.removeAttribute("aria-busy");
  });

  // Filters apply as soon as a choice changes. Price waits for its Apply button.
  const filterForm = document.querySelector("[data-auto-submit]");
  if (filterForm) {
    filterForm.addEventListener("change", event => {
      if (event.target.type === "radio" || event.target.type === "checkbox") filterForm.requestSubmit();
    });
    filterForm.addEventListener("submit", showLoading);
    document.querySelectorAll("[data-auto-submit-field]").forEach(field => {
      field.addEventListener("change", () => filterForm.requestSubmit());
    });
  }
  document.querySelectorAll(".chip, .pagination a").forEach(link => {
    link.addEventListener("click", event => {
      if (!event.metaKey && !event.ctrlKey && !event.shiftKey) showLoading();
    });
  });

  // ---------- Filter drawer (phones and small tablets) ----------
  const catalog = document.querySelector("[data-catalog]");
  const drawer = document.querySelector("[data-filter-drawer]");
  const openButton = document.querySelector("[data-filter-open]");
  if (catalog && drawer && openButton) {
    // Without this script the filters simply show above the results, so nothing is ever out of reach.
    catalog.classList.add("is-enhanced");
    const backdrop = catalog.querySelector(".drawer-backdrop");
    const small = window.matchMedia("(max-width: 900px)");
    const focusable = () => [...drawer.querySelectorAll("a[href], button, input, select")]
      .filter(el => !el.disabled && el.offsetParent !== null);

    const open = () => {
      drawer.classList.add("is-open");
      backdrop.hidden = false;
      document.body.classList.add("drawer-open");
      openButton.setAttribute("aria-expanded", "true");
      drawer.setAttribute("role", "dialog");
      drawer.setAttribute("aria-modal", "true");
      const first = drawer.querySelector("input:checked") || focusable()[0];
      if (first) first.focus();
    };
    const close = () => {
      if (!drawer.classList.contains("is-open")) return;
      drawer.classList.remove("is-open");
      backdrop.hidden = true;
      document.body.classList.remove("drawer-open");
      openButton.setAttribute("aria-expanded", "false");
      drawer.removeAttribute("role");
      drawer.removeAttribute("aria-modal");
      openButton.focus();
    };

    openButton.addEventListener("click", open);
    catalog.querySelectorAll("[data-filter-close]").forEach(el => el.addEventListener("click", close));
    small.addEventListener("change", close);

    drawer.addEventListener("keydown", event => {
      if (!drawer.classList.contains("is-open")) return;
      if (event.key === "Escape") {
        close();
        return;
      }
      // Keep keyboard focus inside the open drawer.
      if (event.key === "Tab") {
        const list = focusable();
        const first = list[0];
        const last = list[list.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    });
  }

  // ---------- Zoom on hover ----------
  // Only for a real mouse: on touch screens there is no hover, so the photo stays as it is.
  const canHover = window.matchMedia("(hover: hover) and (pointer: fine)");
  document.querySelectorAll("[data-zoom]").forEach(frame => {
    const img = frame.querySelector("img");
    if (!img) return;
    frame.addEventListener("pointermove", event => {
      if (!canHover.matches || event.pointerType !== "mouse") return;
      const box = frame.getBoundingClientRect();
      const x = ((event.clientX - box.left) / box.width) * 100;
      const y = ((event.clientY - box.top) / box.height) * 100;
      img.style.transformOrigin = `${x}% ${y}%`;
      frame.classList.add("is-zooming");
    });
    frame.addEventListener("pointerleave", () => frame.classList.remove("is-zooming"));
  });

  // ---------- Product gallery ----------
  document.querySelectorAll("[data-gallery]").forEach(gallery => {
    const main = gallery.querySelector("[data-gallery-main]");
    const thumbs = [...gallery.querySelectorAll(".thumb")];
    const counter = gallery.querySelector("[data-gallery-index]");
    if (!main || !thumbs.length) return;
    let current = Math.max(0, thumbs.findIndex(thumb => thumb.getAttribute("aria-current") === "true"));

    const show = index => {
      current = (index + thumbs.length) % thumbs.length;
      const thumb = thumbs[current];
      main.src = thumb.dataset.src;
      thumbs.forEach(other => other.removeAttribute("aria-current"));
      thumb.setAttribute("aria-current", "true");
      if (counter) counter.textContent = String(current + 1);
    };

    thumbs.forEach((thumb, index) => {
      thumb.addEventListener("click", () => show(index));
      thumb.addEventListener("keydown", event => {
        if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
        event.preventDefault();
        show(current + (event.key === "ArrowRight" ? 1 : -1));
        thumbs[current].focus();
      });
    });
    gallery.querySelectorAll("[data-gallery-step]").forEach(button => {
      button.addEventListener("click", () => show(current + Number(button.dataset.galleryStep)));
    });
  });
})();
