(function () {
  'use strict';
  if (!window.NxPages || !window.NxPages.define) return;
  window.NxPages.define('admin-customer-wallet', (root, signal) => {
    const form = root.querySelector('[data-admin-wallet-form]');
    if (!form) return;
    const money = (paise) =>
      new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        minimumFractionDigits: 2,
      }).format(paise / 100);
    const initialBalance = Number(form.dataset.balance || 0);
    const preview = form.querySelector('[data-wallet-preview]');
    function updatePreview() {
      if (!preview?.querySelector) return;
      const value = form.elements.amount.value;
      const amount = Math.round(Number(value) * 100);
      const valid =
        /^\d+(?:\.\d{1,2})?$/.test(value) && amount > 0 && amount <= 10000000;
      const debit = form.elements.type.value === 'debit';
      const after = initialBalance + (debit ? -amount : amount);
      preview.querySelector('[data-wallet-action-label]').textContent = debit
        ? 'Credit to remove'
        : 'Credit to add';
      preview.querySelector('[data-wallet-change]').textContent = valid
        ? (debit ? '−' : '+') + money(amount)
        : '—';
      preview.querySelector('[data-wallet-after]').textContent = valid
        ? money(after)
        : money(initialBalance);
      preview.classList.toggle('is-invalid', valid && after < 0);
      preview.querySelector('[data-wallet-preview-hint]').textContent =
        valid && after < 0
          ? 'This exceeds the available credit. Choose a smaller amount.'
          : 'Preview only. The latest balance is checked when you apply the adjustment.';
    }
    form.addEventListener('input', updatePreview, {signal});
    form.addEventListener('change', updatePreview, {signal});
    updatePreview();

    const historyTools = root.querySelector('[data-wallet-history-tools]');
    if (historyTools?.hasAttribute?.('data-wallet-history-tools')) {
      const search = historyTools.querySelector('[data-wallet-history-search]');
      const type = historyTools.querySelector('[data-wallet-history-type]');
      const rows = [...root.querySelectorAll('[data-wallet-history-row]')];
      const status = root.querySelector('[data-wallet-history-status]');
      const empty = root.querySelector('[data-wallet-history-empty]');
      const filterHistory = () => {
        const query = search.value.trim().toLowerCase();
        let visible = 0;
        rows.forEach((row) => {
          row.hidden =
            (type.value !== 'all' && row.dataset.type !== type.value) ||
            !row.textContent.toLowerCase().includes(query);
          if (!row.hidden) visible++;
        });
        status.textContent = `Showing ${visible} of ${rows.length} transactions on this page.`;
        empty.hidden = visible !== 0;
      };
      historyTools.hidden = false;
      search.addEventListener('input', filterHistory, {signal});
      type.addEventListener('change', filterHistory, {signal});
      root.querySelector('[data-wallet-history-reset]').addEventListener(
        'click',
        () => {
          search.value = '';
          type.value = 'all';
          filterHistory();
          search.focus();
        },
        {signal},
      );
      filterHistory();
    }
    let pending = null;
    const storageKey = 'nx:wallet-adjust:' + form.dataset.userId;
    try {
      pending = JSON.parse(sessionStorage.getItem(storageKey));
    } catch {
      /* Keep an in-memory reference if storage is unavailable. */
    }
    let busy = false;
    form.addEventListener(
      'submit',
      async (event) => {
        event.preventDefault();
        if (busy || !form.reportValidity()) return;
        busy = true;
        Nx.clearErrors(form);
        const fields = {
          type: form.elements.type.value,
          amount: form.elements.amount.value,
          reason: form.elements.reason.value.trim(),
        };
        const signature = JSON.stringify(fields);
        if (!pending || pending.signature !== signature)
          pending = {signature, requestId: crypto.randomUUID()};
        try {
          sessionStorage.setItem(storageKey, JSON.stringify(pending));
        } catch {
          /* The form retains its adjustment reference. */
        }
        const button = form.querySelector('[type="submit"]');
        try {
          const ok = await Nx.confirm({
            title:
              fields.type === 'credit'
                ? 'Add wallet credit?'
                : 'Remove wallet credit?',
            message: `${fields.amount} rupees for ${root.querySelector('h1').textContent}. Reason: ${fields.reason}`,
            confirmLabel: 'Apply adjustment',
          });
          if (!ok || signal.aborted) return;
          Nx.busy(button, true, 'Updating wallet…');
          const reply = await Nx.submitForm(form, {
            url:
              '/api/admin/customers/' +
              encodeURIComponent(form.dataset.userId) +
              '/wallet/adjust',
            method: 'POST',
            body: {...fields, requestId: pending.requestId},
            busyLabel: 'Updating wallet.',
          });
          if (!reply) return;
          pending = null;
          try {
            sessionStorage.removeItem(storageKey);
          } catch {
            /* Storage can be disabled. */
          }
          if (window.NxNav) {
            await window.NxNav.reload();
            Nx.toast(reply.message);
          } else {
            Nx.flash(reply.message);
            window.location.reload();
          }
        } catch (error) {
          Nx.showErrors(form, error.fieldErrors || {});
          Nx.formAlert(form, error.message, 'error');
        } finally {
          busy = false;
          Nx.busy(button, false);
        }
      },
      {signal},
    );
  });
})();
