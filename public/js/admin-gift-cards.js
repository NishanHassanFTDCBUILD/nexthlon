// Gift cards (admin): switch off an active card. The server checks the card and writes the audit entry.
(function () {
  'use strict';

  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-gift-disable]');
    if (!button) return;
    const ok = await Nx.confirm({
      title: 'Switch off this gift card?',
      message: 'It can no longer be redeemed. This cannot be undone from here.',
      confirmLabel: 'Switch off',
      tone: 'danger',
    });
    if (!ok) return;
    Nx.busy(button, true, 'Switching off…');
    try {
      const reply = await Nx.api(
        `/api/admin/gift-cards/${encodeURIComponent(button.dataset.giftDisable)}/disable`,
        {method: 'POST'},
      );
      Nx.flash(reply.message);
      window.location.reload();
    } catch (error) {
      Nx.busy(button, false);
      Nx.toast(error.message, 'error');
    }
  });
})();
