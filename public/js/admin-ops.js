// Admin operations: packing assignment, recovery retries, return rules and the revenue goal.
(function () {
  'use strict';
  const packingPending = new WeakSet();
  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-packing-order]');
    if (!button || packingPending.has(button)) return;
    packingPending.add(button);
    Nx.busy(button, true, 'Saving…');
    try {
      const reply = await Nx.api(
        `/api/admin/orders/${encodeURIComponent(button.dataset.packingOrder)}/assignment`,
        {method: 'POST', body: {action: button.dataset.packingAction}},
      );
      Nx.toast(reply.message);
      await window.NxNav.reload();
    } catch (error) {
      Nx.toast(error.message, 'error');
    } finally {
      packingPending.delete(button);
      Nx.busy(button, false);
    }
  });
  const pendingRecovery = new WeakSet();
  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-recovery-url]');
    if (!button || pendingRecovery.has(button)) return;
    pendingRecovery.add(button);
    try {
      if (
        !(await Nx.confirm({
          title: 'Retry this work?',
          message:
            'Confirmed inventory rows are skipped. Background tasks run when a worker is available.',
          confirmLabel: 'Retry work',
        }))
      )
        return;
      Nx.busy(button, true, 'Queuing…');
      const reply = await Nx.api(button.dataset.recoveryUrl, {method: 'POST'});
      Nx.toast(reply.message || 'Recovery finished. Review the row outcomes.');
      await window.NxNav.reload();
    } catch (error) {
      Nx.toast(error.message, 'error');
    } finally {
      pendingRecovery.delete(button);
      Nx.busy(button, false);
    }
  });

  // ---------- Return rules: save the automatic and owner approval limits ----------
  document.addEventListener('submit', async (event) => {
    if (!event.target.matches('[data-return-rules]')) return;
    const form = event.target;
    event.preventDefault();
    const button = form.querySelector('[type="submit"]');
    Nx.busy(button, true, 'Saving…');
    try {
      const reply = await Nx.api('/api/admin/returns/rules', {
        method: 'PATCH',
        body: {
          autoApproveRupees: form.elements.autoApproveRupees.value,
          ownerApproveRupees: form.elements.ownerApproveRupees.value,
        },
      });
      Nx.flash(reply.message);
      window.location.reload();
    } catch (error) {
      Nx.busy(button, false);
      Nx.toast(error.message, 'error');
    }
  });

  // ---------- Monthly revenue goal: save the target for the month ----------
  document.addEventListener('submit', async (event) => {
    const form = event.target.closest('[data-goal-form]');
    if (!form) return;
    event.preventDefault();
    const button = form.querySelector('[type="submit"]');
    Nx.busy(button, true, 'Saving…');
    try {
      const reply = await Nx.api(
        '/api/admin/goals/' + encodeURIComponent(form.dataset.goalForm),
        {
          method: 'PATCH',
          body: {
            amount:
              form.elements.amount.value === ''
                ? 0
                : Number(form.elements.amount.value),
          },
        },
      );
      Nx.flash(reply.message);
      window.location.reload();
    } catch (error) {
      Nx.busy(button, false);
      Nx.toast(error.message, 'error');
    }
  });
})();
