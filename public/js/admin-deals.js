// Admin Deals of the Day: the list (turn on/off, delete) and the create/edit form with a live
// deal price preview. The server checks everything again (utils/validators.js validateDeal) and
// works out the real price (utils/pricing.js), so the preview is only a guide.
(function () {
  'use strict';

  const Pages = window.NxPages;
  if (!Pages || !Pages.define) return;
  const go = (href) =>
    window.NxNav && window.NxNav.inArea(href)
      ? window.NxNav.go(href)
      : window.location.assign(href);
  const rupees = (paise) =>
    `₹${(paise / 100).toLocaleString('en-IN', {maximumFractionDigits: 2})}`;
  const LABELS = {
    live: ['Live now', 'pill-green'],
    scheduled: ['Starts later', 'pill-blue'],
    ended: ['Ended', 'pill-grey'],
    disabled: ['Turned off', 'pill-amber'],
  };

  // ---------- The list ----------
  Pages.define('admin-deals', (root, signal) => {
    root.addEventListener(
      'click',
      async (event) => {
        const toggle = event.target.closest('[data-deal-toggle]');
        const remove = event.target.closest('[data-deal-delete]');
        if (toggle) await toggleDeal(toggle);
        else if (remove) await deleteDeal(remove);
      },
      {signal},
    );

    async function toggleDeal(button) {
      const id = button.dataset.dealToggle;
      const active = button.dataset.active === 'true';
      const name = button.dataset.name;
      const ok = await Nx.confirm({
        title: active
          ? `Turn off the deal on ${name}?`
          : `Turn on the deal on ${name}?`,
        message: active
          ? 'The usual price comes back at once. Orders already placed keep their price.'
          : 'If it is inside its times, the deal price starts at once.',
        confirmLabel: active ? 'Turn it off' : 'Turn it on',
        tone: active ? 'danger' : 'primary',
      });
      if (!ok) return;
      Nx.busy(button, true, active ? 'Turning off…' : 'Turning on…');
      try {
        const reply = await Nx.api(
          `/api/admin/deals/${encodeURIComponent(id)}/active`,
          {method: 'PATCH', body: {isActive: !active}},
        );
        Nx.busy(button, false);
        const deal = reply.deal;
        button.dataset.active = String(deal.isActive);
        button.textContent = deal.isActive ? 'Turn off' : 'Turn on';
        button.className = `btn btn-sm ${deal.isActive ? 'btn-danger-soft' : 'btn-secondary'}`;
        button.setAttribute(
          'aria-label',
          `${deal.isActive ? 'Turn off' : 'Turn on'} the deal on ${name}`,
        );
        const row = button.closest('[data-deal-row]');
        const pill = row && row.querySelector('[data-deal-status]');
        if (pill && LABELS[deal.status]) {
          pill.textContent = LABELS[deal.status][0];
          pill.className = `pill ${LABELS[deal.status][1]}`;
        }
        Nx.toast(reply.message);
      } catch (error) {
        Nx.busy(button, false);
        Nx.toast(error.message, 'error');
      }
    }

    async function deleteDeal(button) {
      const id = button.dataset.dealDelete;
      const ok = await Nx.confirm({
        title: `Delete the deal on ${button.dataset.name}?`,
        message:
          'If it is live, the usual price comes back at once. Orders already placed keep their price.',
        confirmLabel: 'Delete the deal',
      });
      if (!ok) return;
      Nx.busy(button, true, 'Deleting…');
      try {
        const reply = await Nx.api(
          `/api/admin/deals/${encodeURIComponent(id)}`,
          {method: 'DELETE'},
        );
        const row = button.closest('[data-deal-row]');
        if (row) row.remove();
        Nx.toast(reply.message);
      } catch (error) {
        Nx.busy(button, false);
        Nx.toast(error.message, 'error');
      }
    }
  });

  // ---------- The create / edit form ----------
  Pages.define('admin-deal-form', (root, signal) => {
    const form = root.querySelector('[data-deal-form]');
    if (!form) return;
    const product = form.querySelector('[data-deal-product]');
    const percent = form.querySelector('[data-deal-percent]');
    const preview = form.querySelector('[data-deal-preview]');

    // Same sum as utils/pricing.js priceFor: base price less the percent, half rounds up.
    function showPreview() {
      const option = product.selectedOptions[0];
      const base = option ? Number(option.dataset.base) : 0;
      const mrp = option ? Number(option.dataset.mrp) : 0;
      const off = Number(percent.value);
      if (!base || !(off >= 1 && off <= 90)) {
        preview.textContent = 'Choose a product and a discount.';
        return;
      }
      const price = Math.floor((base * (100 - off)) / 100 + 0.5);
      const saving = mrp > price ? Math.round(((mrp - price) / mrp) * 100) : 0;
      preview.textContent = `${rupees(price)} (M.R.P. ${rupees(mrp)}, ${saving}% off for the shopper), unless the product already has a bigger offer.`;
    }
    product.addEventListener('change', showPreview, {signal});
    percent.addEventListener('input', showPreview, {signal});
    showPreview();

    form.addEventListener(
      'submit',
      async (event) => {
        event.preventDefault();
        const body = Nx.formValues(form);
        body.isActive = form.elements.isActive.checked;
        const reply = await Nx.submitForm(form, {
          url: form.dataset.endpoint,
          method: form.dataset.method,
          body,
          busyLabel: 'Saving…',
        });
        if (!reply) return;
        Nx.flash(reply.message);
        go(form.dataset.done);
      },
      {signal},
    );
  });
})();
