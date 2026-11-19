// Price-drop alerts: the "Tell me if the price drops" button on a product page.
// Signed-in customers only (the button is not rendered for anyone else).
(function () {
  'use strict';

  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-price-watch]');
    if (!button) return;
    const id = encodeURIComponent(button.dataset.priceWatchId);
    const on = button.getAttribute('aria-pressed') === 'true';
    Nx.busy(button, true, 'Saving…');
    try {
      const reply = await Nx.api(`/api/products/${id}/price-watch`, {
        method: on ? 'DELETE' : 'POST',
      });
      button.setAttribute('aria-pressed', String(reply.watching));
      button.textContent = reply.watching
        ? 'Price alert on: we will email you if it drops'
        : 'Tell me if the price drops';
      Nx.toast(reply.message);
    } catch (error) {
      Nx.toast(error.message, 'error');
    } finally {
      Nx.busy(button, false);
    }
  });
})();
