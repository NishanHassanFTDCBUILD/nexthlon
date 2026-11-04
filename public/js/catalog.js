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
    // Empty fields are left out, so the URL only holds filters that are really set
    // ("?category=running&max=3000", not "?category=running&min=&max=3000&rating=").
    filterForm.addEventListener("submit", () => {
      const fields = [...filterForm.elements, ...document.querySelectorAll('[form="filters"]')];
      fields.forEach(field => {
        if (!field.name || field.disabled) return;
        const unchecked = (field.type === "radio" || field.type === "checkbox") && !field.checked;
        if (unchecked) return;
        if (field.value === "" || (field.name === "sort" && field.value === "relevance")) {
          field.disabled = true;
          field.dataset.wasEmpty = "1";
        }
      });
      showLoading();
    });
    // Coming back to this page: switch those fields on again.
    window.addEventListener("pageshow", () => {
      document.querySelectorAll("[data-was-empty]").forEach(field => {
        field.disabled = false;
        delete field.dataset.wasEmpty;
      });
    });
    document.querySelectorAll("[data-auto-submit-field]").forEach(field => {
      field.addEventListener("change", () => filterForm.requestSubmit());
    });
  }
  document.querySelectorAll(".chip, .pagination a").forEach(link => {
    link.addEventListener("click", event => {
      if (!event.metaKey && !event.ctrlKey && !event.shiftKey) showLoading();
    });
  });

  // ---------- Price range slider ----------
  // Two range handles drive the min/max boxes. Only the boxes are sent, and a box left at
  // the end of the range is sent empty, so the URL stays clean.
  const priceBox = document.querySelector("[data-price-filter]");
  if (priceBox) {
    const slider = priceBox.querySelector("[data-range]");
    const lowRange = priceBox.querySelector("[data-range-min]");
    const highRange = priceBox.querySelector("[data-range-max]");
    const minBox = priceBox.querySelector("[data-price-min]");
    const maxBox = priceBox.querySelector("[data-price-max]");
    const fill = priceBox.querySelector("[data-range-fill]");
    const low = Number(priceBox.dataset.low);
    const high = Number(priceBox.dataset.high);
    const rupees = value => `₹${Number(value).toLocaleString("en-IN")}`;

    const paint = () => {
      const span = high - low || 1;
      fill.style.setProperty("--from", String((Number(lowRange.value) - low) / span));
      fill.style.setProperty("--to", String((Number(highRange.value) - low) / span));
      lowRange.setAttribute("aria-valuetext", rupees(lowRange.value));
      highRange.setAttribute("aria-valuetext", rupees(highRange.value));
    };
    const fromRanges = moved => {
      if (Number(lowRange.value) > Number(highRange.value)) {
        if (moved === lowRange) lowRange.value = highRange.value;
        else highRange.value = lowRange.value;
      }
      minBox.value = Number(lowRange.value) <= low ? "" : lowRange.value;
      maxBox.value = Number(highRange.value) >= high ? "" : highRange.value;
      paint();
    };
    const fromBoxes = () => {
      lowRange.value = minBox.value === "" ? low : Math.min(Math.max(Number(minBox.value), low), high);
      highRange.value = maxBox.value === "" ? high : Math.min(Math.max(Number(maxBox.value), low), high);
      paint();
    };
    if (high > low) {
      slider.hidden = false;
      lowRange.addEventListener("input", () => fromRanges(lowRange));
      highRange.addEventListener("input", () => fromRanges(highRange));
      // Letting go of a handle applies the new range.
      [lowRange, highRange].forEach(range => range.addEventListener("change", () => filterForm && filterForm.requestSubmit()));
      minBox.addEventListener("input", fromBoxes);
      maxBox.addEventListener("input", fromBoxes);
      paint();
    }
  }

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
