// Size swap on an order: pick the new size in a dialog, then ask the store to confirm it.
(function () {
  'use strict';

  const dialog = document.getElementById('exchange-dialog');
  const form = document.querySelector('[data-exchange-form]');
  if (!dialog || !form) return;

  const select = form.elements.variantId;
  const itemInput = form.elements.itemId;
  const name = dialog.querySelector('[data-exchange-name]');

  const openDialog = () => {
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  };
  const closeDialog = () => {
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
  };

  document.addEventListener('click', (event) => {
    const open = event.target.closest('[data-exchange-open]');
    if (open) {
      event.preventDefault();
      let options;
      try {
        options = JSON.parse(open.dataset.options || '[]');
      } catch {
        options = [];
      }
      select.replaceChildren(
        ...options.map((option) => {
          const node = document.createElement('option');
          node.value = option.id;
          node.textContent = option.label;
          return node;
        }),
      );
      itemInput.value = open.dataset.exchangeOpen;
      name.textContent = open.dataset.itemName || '';
      form.querySelector('[data-form-alert]').textContent = '';
      openDialog();
      return;
    }
    if (event.target.closest('[data-exchange-close]')) closeDialog();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('[data-exchange-submit]');
    const alert = form.querySelector('[data-form-alert]');
    alert.textContent = '';
    Nx.busy(button, true, 'Sending…');
    try {
      const reply = await Nx.api(
        `/api/orders/${encodeURIComponent(form.dataset.order)}/exchange`,
        {
          method: 'POST',
          body: {itemId: itemInput.value, variantId: select.value},
        },
      );
      closeDialog();
      Nx.flash(reply.message);
      window.location.reload();
    } catch (error) {
      alert.textContent = error.message;
      Nx.busy(button, false);
    }
  });
})();
