// Size swaps (admin): approve or decline a request, and mark a swap as done once the parcel is back.
(function () {
  'use strict';

  const labels = {
    approve: 'Approve this swap?',
    decline: 'Decline this swap?',
    complete: 'Mark this swap as done?',
  };
  const details = {
    approve: 'The new size is held from stock now, so the parcel can be sent.',
    decline: 'The customer keeps their current size. Nothing is held.',
    complete:
      'The old size goes back into stock. Only do this once the new size is sent and the old one is back.',
  };

  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-exchange-action]');
    if (!button) return;
    const action = button.dataset.exchangeAction;
    const ok = await Nx.confirm({
      title: labels[action] || 'Continue?',
      message: details[action] || '',
      confirmLabel: action === 'decline' ? 'Decline' : 'Confirm',
      tone: action === 'decline' ? 'danger' : 'primary',
    });
    if (!ok) return;
    Nx.busy(button, true, 'Saving…');
    try {
      const reply = await Nx.api(
        `/api/admin/orders/${encodeURIComponent(button.dataset.order)}/items/${encodeURIComponent(button.dataset.item)}/exchange`,
        {method: 'POST', body: {action}},
      );
      Nx.flash(reply.message);
      window.location.reload();
    } catch (error) {
      Nx.busy(button, false);
      Nx.toast(error.message, 'error');
    }
  });
})();
