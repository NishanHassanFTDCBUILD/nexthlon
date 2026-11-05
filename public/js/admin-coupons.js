// Admin Coupons: the list (enable/disable, delete), the create/edit form, and the detail page.
// The form only makes things pleasant; every rule is checked again on the server
// (utils/validators.js validateCoupon), so a changed form cannot save a bad coupon.
(function () {
  "use strict";

  const Pages = window.NxPages;
  if (!Pages || !Pages.define) return;
  const BASE = document.body.dataset.adminPath || "";
  const go = href => (window.NxNav && window.NxNav.inArea(href) ? window.NxNav.go(href) : window.location.assign(href));

  // Enable/disable and delete work the same on the list and on the detail page.
  function wireRowActions(root, signal, { onDeleted }) {
    root.addEventListener("click", async event => {
      const toggle = event.target.closest("[data-coupon-toggle]");
      const remove = event.target.closest("[data-coupon-delete]");
      if (!toggle && !remove) return;

      if (toggle) {
        const id = toggle.dataset.couponToggle;
        const isActive = toggle.dataset.active === "true";
        const code = toggle.dataset.code;
        const ok = await Nx.confirm({
          title: isActive ? `Disable ${code}?` : `Enable ${code}?`,
          message: isActive
            ? "Customers will be told the code is not valid from the next checkout onwards. Orders already placed keep their discount."
            : "Customers who qualify will be able to use this code again.",
          confirmLabel: isActive ? "Disable the coupon" : "Enable the coupon",
          tone: isActive ? "danger" : "primary"
        });
        if (!ok) return;
        Nx.busy(toggle, true, isActive ? "Disabling…" : "Enabling…");
        try {
          const reply = await Nx.api(`/api/admin/coupons/${encodeURIComponent(id)}/active`, { method: "PATCH", body: { isActive: !isActive } });
          Nx.busy(toggle, false);
          const coupon = reply.coupon;
          toggle.dataset.active = String(coupon.isActive);
          toggle.textContent = coupon.isActive ? "Disable" : "Enable";
          toggle.className = `btn btn-sm ${coupon.isActive ? "btn-danger-soft" : "btn-secondary"}`;
          toggle.setAttribute("aria-label", `${coupon.isActive ? "Disable" : "Enable"} ${code}`);
          // The status word can change in more ways than on/off (expired, fully used...).
          root.querySelectorAll("[data-coupon-status]").forEach(pill => {
            const row = pill.closest("[data-coupon-row]");
            if (row && row.dataset.couponRow !== id) return;
            pill.textContent = { active: "Running now", scheduled: "Starts later", expired: "Expired", disabled: "Disabled", used_up: "Fully used" }[coupon.status] || coupon.status;
            pill.className = `pill ${{ active: "pill-green", scheduled: "pill-blue", expired: "pill-red", disabled: "pill-grey", used_up: "pill-amber" }[coupon.status] || "pill-grey"}`;
          });
          Nx.toast(reply.message);
        } catch (error) {
          Nx.busy(toggle, false);
          Nx.toast(error.message, "error");
        }
        return;
      }

      const id = remove.dataset.couponDelete;
      const code = remove.dataset.code;
      const ok = await Nx.confirm({
        title: `Delete ${code}?`,
        message: "The code can never be used again and leaves this list. Orders that used it keep their history, so your reports stay correct.",
        confirmLabel: "Delete the coupon"
      });
      if (!ok) return;
      Nx.busy(remove, true, "Deleting…");
      try {
        const reply = await Nx.api(`/api/admin/coupons/${encodeURIComponent(id)}`, { method: "DELETE" });
        onDeleted(id, reply.message);
      } catch (error) {
        Nx.busy(remove, false);
        Nx.toast(error.message, "error");
      }
    }, { signal });
  }

  // ---------- The list ----------
  Pages.define("admin-coupons", (root, signal) => {
    wireRowActions(root, signal, {
      onDeleted(id, message) {
        const row = root.querySelector(`[data-coupon-row="${id}"]`);
        if (row) row.remove();
        Nx.toast(message);
      }
    });
  });

  // ---------- One coupon ----------
  Pages.define("admin-coupon-detail", (root, signal) => {
    wireRowActions(root, signal, {
      onDeleted(id, message) {
        Nx.flash(message);
        go(`${BASE}/coupons`);
      }
    });
  });

  // ---------- The create / edit form ----------
  Pages.define("admin-coupon-form", (root, signal) => {
    const form = root.querySelector("[data-coupon-form]");
    if (!form) return;

    // A flat coupon has no percentage cap, so that field only makes sense for percent coupons.
    const type = form.querySelector("[data-coupon-type]");
    const cap = form.querySelector("[data-coupon-cap]");
    const valueLabel = form.querySelector("[data-coupon-value-label]");
    const valueHint = form.querySelector("[data-coupon-value-hint]");
    const valueInput = form.elements.value;

    function applyType() {
      const percent = type.value === "percent";
      cap.hidden = !percent;
      if (!percent) form.elements.maxDiscount.value = "";
      valueLabel.textContent = percent ? "Percentage off" : "Amount off (₹)";
      valueHint.textContent = percent ? "A whole percentage from 1 to 90." : "In rupees, at least ₹1.";
      valueInput.max = percent ? "90" : "10000000";
    }
    type.addEventListener("change", applyType, { signal });
    applyType();

    // The code is stored in capitals, so show it that way as it is typed.
    form.elements.code.addEventListener("input", event => {
      const field = event.target;
      const at = field.selectionStart;
      field.value = field.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
      field.setSelectionRange(at, at);
    }, { signal });

    form.addEventListener("submit", async event => {
      event.preventDefault();
      const body = Nx.formValues(form);
      // An unchecked checkbox is simply absent, so make the intent explicit either way.
      body.isActive = form.elements.isActive.checked;
      const reply = await Nx.submitForm(form, {
        url: form.dataset.endpoint,
        method: form.dataset.method,
        body,
        busyLabel: "Saving…"
      });
      if (!reply) return;
      Nx.flash(reply.message);
      go(form.dataset.done);
    }, { signal });
  });
})();
