// Product list filters and the product photo gallery.
(function () {
  "use strict";

  // Filters apply as soon as a choice changes. Price waits for its Apply button.
  const filterForm = document.querySelector("[data-auto-submit]");
  if (filterForm) {
    filterForm.addEventListener("change", event => {
      if (event.target.type === "radio" || event.target.type === "checkbox") filterForm.requestSubmit();
    });
    document.querySelectorAll("[data-auto-submit-field]").forEach(field => {
      field.addEventListener("change", () => filterForm.requestSubmit());
    });
  }

  // On phones, start with the filter panel closed so the products show first.
  const panel = document.querySelector("[data-filter-panel]");
  if (panel && window.matchMedia("(max-width: 900px)").matches) panel.open = false;

  // Clicking a thumbnail swaps the main product photo.
  document.querySelectorAll("[data-gallery]").forEach(gallery => {
    const main = gallery.querySelector("[data-gallery-main]");
    gallery.querySelectorAll(".thumb").forEach(thumb => {
      thumb.addEventListener("click", () => {
        main.src = thumb.dataset.src;
        gallery.querySelectorAll(".thumb").forEach(other => other.removeAttribute("aria-current"));
        thumb.setAttribute("aria-current", "true");
      });
    });
  });
})();
