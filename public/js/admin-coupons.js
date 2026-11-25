// Admin Coupons: the list (enable/disable, delete), the create/edit form, and the detail page.
// The form only makes things pleasant; every rule is checked again on the server
// (utils/validators.js validateCoupon), so a changed form cannot save a bad coupon.
(function () {
  'use strict';

  const Pages = window.NxPages;
  if (!Pages || !Pages.define) return;
  const BASE = document.body.dataset.adminPath || '';
  const go = (href) =>
    window.NxNav && window.NxNav.inArea(href)
      ? window.NxNav.go(href)
      : window.location.assign(href);

  // Enable/disable and delete work the same on the list and on the detail page.
  function wireRowActions(root, signal, {onDeleted, onChanged}) {
    const pending = new Set();
    root.addEventListener(
      'click',
      async (event) => {
        const toggle = event.target.closest('[data-coupon-toggle]');
        const remove = event.target.closest('[data-coupon-delete]');
        const button = toggle || remove;
        if (!button || button.disabled) return;
        event.preventDefault();
        const id = toggle
          ? toggle.dataset.couponToggle
          : remove.dataset.couponDelete;
        if (pending.has(id)) return;
        pending.add(id);
        const code = button.dataset.code;
        const active = button.dataset.active === 'true';
        const action = remove ? 'Delete' : active ? 'Disable' : 'Enable';
        try {
          const confirmed = await Nx.confirm({
            title: action + ' ' + code + '?',
            message: remove
              ? 'This code will leave the list and cannot be reused. Past orders keep their coupon history.'
              : active
                ? 'Stop new checkouts from using this code. Existing orders keep their discount.'
                : 'Enable this code. Its dates and usage limits still apply.',
            confirmLabel: action + ' coupon',
            tone: remove || active ? 'danger' : 'primary',
          });
          if (!confirmed || signal.aborted) return;
          Nx.busy(button, true, 'Saving…');
          const reply = await Nx.api(
            '/api/admin/coupons/' +
              encodeURIComponent(id) +
              (toggle ? '/active' : ''),
            {
              method: toggle ? 'PATCH' : 'DELETE',
              ...(toggle ? {body: {isActive: !active}} : {}),
            },
          );
          if (signal.aborted) return;
          if (remove) await onDeleted(id, reply.message);
          else await onChanged(reply.message);
        } catch (error) {
          if (!signal.aborted) Nx.toast(error.message, 'error');
        } finally {
          pending.delete(id);
          Nx.busy(button, false);
        }
      },
      {signal},
    );
  }

  // Refresh the data, totals and tabs together after a mutation. Start on page one because the last
  // row on a filtered page may have disappeared; preserve the search, status, sort and page size.
  function refreshList(message) {
    const url = new URL(window.location.href);
    url.searchParams.delete('page');
    Nx.flash(message);
    return go(url.pathname + url.search);
  }
  Pages.define('admin-coupons', (root, signal) => {
    wireRowActions(root, signal, {
      onDeleted: (id, message) => refreshList(message),
      onChanged: refreshList,
    });
  });

  Pages.define('admin-coupon-detail', (root, signal) => {
    wireRowActions(root, signal, {
      onDeleted(id, message) {
        Nx.flash(message);
        return go(BASE + '/coupons');
      },
      onChanged(message) {
        Nx.flash(message);
        if (window.NxNav) return window.NxNav.reload();
        window.location.reload();
      },
    });
  });

  // ---------- The create / edit form ----------
  Pages.define('admin-coupon-form', (root, signal) => {
    const form = root.querySelector('[data-coupon-form]');
    if (!form) return;

    // A flat coupon has no percentage cap, so that field only makes sense for percent coupons.
    const type = form.querySelector('[data-coupon-type]');
    const cap = form.querySelector('[data-coupon-cap]');
    const valueLabel = form.querySelector('[data-coupon-value-label]');
    const valueHint = form.querySelector('[data-coupon-value-hint]');
    const valueInput = form.elements.value;

    function applyType() {
      const percent = type.value === 'percent';
      cap.hidden = !percent;
      if (!percent) form.elements.maxDiscount.value = '';
      valueLabel.textContent = percent ? 'Percentage off' : 'Amount off (₹)';
      valueHint.textContent = percent
        ? 'A whole percentage from 1 to 90.'
        : 'In rupees, at least ₹1.';
      valueInput.max = percent ? '90' : '10000000';
      valueInput.step = percent ? '1' : '0.01';
      valueInput.inputMode = percent ? 'numeric' : 'decimal';
      updatePreview();
    }
    function updatePreview() {
      const code = form.querySelector('[data-coupon-preview-code]');
      const offer = form.querySelector('[data-coupon-preview-value]');
      const rule = form.querySelector('[data-coupon-preview-rule]');
      if (!code || !offer || !rule) return;
      const amount = Number(valueInput.value) || 0;
      const min = Number(form.elements.minOrder.value) || 0;
      const max = Number(form.elements.maxDiscount.value) || 0;
      code.textContent = form.elements.code.value || 'YOURCODE';
      offer.textContent =
        type.value === 'percent'
          ? amount + '% off'
          : Nx.formatPrice(Math.round(amount * 100)) + ' off';
      rule.textContent =
        (min > 0
          ? 'On orders from ' + Nx.formatPrice(Math.round(min * 100))
          : 'No minimum order') +
        (type.value === 'percent' && max > 0
          ? ' · Maximum savings ' + Nx.formatPrice(Math.round(max * 100))
          : '');
    }
    form.addEventListener('input', updatePreview, {signal});
    type.addEventListener('change', applyType, {signal});
    applyType();

    // The code is stored in capitals, so show it that way as it is typed.
    form.elements.code.addEventListener(
      'input',
      (event) => {
        const field = event.target;
        const at = field.selectionStart;
        field.value = field.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
        field.setSelectionRange(at, at);
      },
      {signal},
    );

    let saving = false;
    form.addEventListener(
      'submit',
      async (event) => {
        event.preventDefault();
        if (saving || signal.aborted) return;
        saving = true;
        const body = Nx.formValues(form);
        // An unchecked checkbox is simply absent, so make the intent explicit either way.
        body.isActive = form.elements.isActive.checked;
        try {
          const reply = await Nx.submitForm(form, {
            url: form.dataset.endpoint,
            method: form.dataset.method,
            body,
            busyLabel: 'Saving…',
          });
          if (!reply || signal.aborted) return;
          Nx.flash(reply.message);
          go(form.dataset.done);
        } finally {
          saving = false;
        }
      },
      {signal},
    );
  });
})();
