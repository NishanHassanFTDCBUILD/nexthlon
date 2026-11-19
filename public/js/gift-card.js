// Redeem a gift card: the code goes to the server, and the value is added to the wallet.
(function () {
  'use strict';

  const form = document.querySelector('[data-gift-redeem]');
  if (!form) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('[data-gift-button]');
    const alert = form.querySelector('[data-form-alert]');
    alert.textContent = '';
    Nx.busy(button, true, 'Adding…');
    try {
      const reply = await Nx.api('/api/wallet/gift-cards/redeem', {
        method: 'POST',
        body: {code: form.elements.code.value},
      });
      Nx.flash(reply.message);
      window.location.assign('/account');
    } catch (error) {
      alert.textContent = error.message;
      Nx.busy(button, false);
    }
  });
})();
