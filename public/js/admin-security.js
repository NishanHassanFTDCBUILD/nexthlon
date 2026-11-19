// Account security (admin): start the setup, confirm it, see the recovery codes once, or turn two-step sign-in off.
(function () {
  'use strict';

  const base = '/api/admin/security/2fa';

  const setupButton = document.querySelector('[data-security-setup]');
  if (setupButton) {
    setupButton.addEventListener('click', async () => {
      Nx.busy(setupButton, true, 'Starting…');
      try {
        const reply = await Nx.api(`${base}/setup`, {method: 'POST'});
        document.querySelector('[data-security-key]').textContent =
          reply.secret;
        document
          .querySelector('[data-security-uri]')
          .setAttribute('href', reply.otpauthUrl);
        document.querySelector('[data-security-setup-panel]').hidden = false;
        setupButton.hidden = true;
      } catch (error) {
        Nx.busy(setupButton, false);
        Nx.toast(error.message, 'error');
      }
    });
  }

  function wire(formSelector, path, onDone) {
    const form = document.querySelector(formSelector);
    if (!form) return;
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = form.querySelector('[data-security-submit]');
      const alert = form.querySelector('[data-form-alert]');
      alert.textContent = '';
      Nx.busy(button, true, 'Checking…');
      try {
        const reply = await Nx.api(`${base}/${path}`, {
          method: 'POST',
          body: {code: form.elements.code.value.trim()},
        });
        onDone(reply);
      } catch (error) {
        alert.textContent = error.message;
        Nx.busy(button, false);
      }
    });
  }

  wire('[data-security-enable]', 'enable', (reply) => {
    const list = document.querySelector('[data-security-codes]');
    list.replaceChildren(
      ...reply.recoveryCodes.map((code) => {
        const li = document.createElement('li');
        li.textContent = code;
        return li;
      }),
    );
    document.querySelector('[data-security-recovery]').hidden = false;
    document.querySelector('[data-security-enable]').hidden = true;
    Nx.toast(reply.message);
  });

  wire('[data-security-disable]', 'disable', (reply) => {
    Nx.flash(reply.message);
    window.location.reload();
  });
})();
