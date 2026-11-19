// Sign in with a code sent to your phone: step one asks for the number, step two for the code.
(function () {
  'use strict';

  const requestForm = document.querySelector('[data-phone-request]');
  const verifyForm = document.querySelector('[data-phone-verify]');
  if (!requestForm || !verifyForm) return;

  let phone = '';
  const status = verifyForm.querySelector('[data-code-status]');

  function showAlert(form, message) {
    const alert = form.querySelector('[data-form-alert]');
    if (alert) alert.textContent = message || '';
  }

  requestForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = requestForm.querySelector('[data-request-button]');
    phone = requestForm.elements.phone.value.trim();
    showAlert(requestForm, '');
    Nx.busy(button, true, 'Sending…');
    try {
      const reply = await Nx.api('/api/auth/phone/request', {
        method: 'POST',
        body: {phone},
      });
      status.textContent = reply.message;
      requestForm.hidden = true;
      verifyForm.hidden = false;
      verifyForm.elements.code.focus();
    } catch (error) {
      showAlert(requestForm, error.message);
    } finally {
      Nx.busy(button, false);
    }
  });

  verifyForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = verifyForm.querySelector('[data-verify-button]');
    showAlert(verifyForm, '');
    Nx.busy(button, true, 'Signing in…');
    try {
      const reply = await Nx.api('/api/auth/phone/verify', {
        method: 'POST',
        body: {phone, code: verifyForm.elements.code.value.trim()},
      });
      Nx.flash(reply.message);
      window.location.assign('/account');
    } catch (error) {
      showAlert(verifyForm, error.message);
      Nx.busy(button, false);
    }
  });

  verifyForm
    .querySelector('[data-change-number]')
    .addEventListener('click', () => {
      verifyForm.hidden = true;
      requestForm.hidden = false;
      requestForm.elements.phone.focus();
    });
})();
