(function () {
  'use strict';
  if (!window.NxPages || !window.NxPages.define) return;
  window.NxPages.define('admin-customer-wallet', (root, signal) => {
    const form = root.querySelector('[data-admin-wallet-form]');
    if (!form) return;
    let pending = null;
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
          const reply = await Nx.api(
            `/api/admin/customers/${encodeURIComponent(form.dataset.userId)}/wallet/adjust`,
            {method: 'POST', body: {...fields, requestId: pending.requestId}},
          );
          pending = null;
          Nx.flash(reply.message);
          window.location.reload();
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
