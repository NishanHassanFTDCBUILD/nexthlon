// Admin UI kit page: theme buttons, a loading-button demo, the quantity stepper, toasts and the confirm popup.
(function () {
  "use strict";

  const page = document.querySelector("[data-design-system]");
  if (!page) return;

  const themeButtons = [...page.querySelectorAll("[data-ds-theme]")];
  function showTheme() {
    const mode = window.NxTheme ? window.NxTheme.get() : "system";
    themeButtons.forEach(button => button.setAttribute("aria-pressed", String(button.dataset.dsTheme === mode)));
  }
  themeButtons.forEach(button => button.addEventListener("click", () => window.NxTheme && window.NxTheme.set(button.dataset.dsTheme)));
  document.addEventListener("nx:theme", showTheme);
  showTheme();

  page.querySelectorAll("[data-ds-loading]").forEach(button => {
    button.addEventListener("click", () => {
      Nx.busy(button, true, "Saving…");
      setTimeout(() => Nx.busy(button, false), 1600);
    });
  });

  const qtyValue = page.querySelector("[data-ds-qty-value]");
  page.querySelectorAll("[data-ds-qty]").forEach(button => {
    button.addEventListener("click", () => {
      qtyValue.textContent = String(Math.min(5, Math.max(1, Number(qtyValue.textContent) + Number(button.dataset.dsQty))));
    });
  });

  page.querySelectorAll("[data-ds-toast]").forEach(button => {
    button.addEventListener("click", () => {
      const error = button.dataset.dsToast === "error";
      Nx.toast(error ? "We couldn't save that. Please try again." : "Saved. Your changes are live.", error ? "error" : "success");
    });
  });

  page.querySelectorAll("[data-ds-confirm]").forEach(button => {
    button.addEventListener("click", async () => {
      const ok = await Nx.confirm({ title: "Delete this coupon?", message: "Shoppers will not be able to use it any more.", confirmLabel: "Delete coupon" });
      Nx.toast(ok ? "Coupon deleted (demo)." : "Nothing changed.");
    });
  });

  page.querySelectorAll(".chip-remove").forEach(button => {
    button.addEventListener("click", () => button.closest(".chip").remove());
  });
})();
