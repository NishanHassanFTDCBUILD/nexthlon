// Customer 360: save the team's private note.
(function () {
  'use strict';

  document.addEventListener('submit', async (event) => {
    const form = event.target.closest('[data-customer-note]');
    if (!form) return;
    event.preventDefault();
    const button = form.querySelector('[type="submit"]');
    Nx.busy(button, true, 'Saving…');
    try {
      const reply = await Nx.api(
        `/api/admin/customers/${encodeURIComponent(form.dataset.customerNote)}/note`,
        {method: 'PATCH', body: {note: form.elements.note.value}},
      );
      Nx.toast(reply.message);
    } catch (error) {
      Nx.toast(error.message, 'error');
    } finally {
      Nx.busy(button, false);
    }
  });
})();
