// One editor for the inventory list, mounted again after partial navigation.
(function () {
  'use strict';

  function mount(root, signal) {
    const dialog = root.querySelector('[data-inventory-drawer]');
    if (!dialog) return;
    const products = new Map(
      JSON.parse(
        root.querySelector('[data-inventory-products]').textContent,
      ).map((product) => [product.id, product]),
    );
    const form = dialog.querySelector('[data-stock-drawer-form]');
    const fields = form.elements;
    const section = form.querySelector('[data-stock-product-fields]');
    const content = form.querySelector('[data-stock-fieldset]');
    const submit = form.querySelector('[data-stock-submit]');
    const status = form.querySelector('[data-stock-drawer-status]');
    const discard = form.querySelector('[data-stock-discard]');
    let product = null;
    let mode = 'existing';
    let action = 'add';
    let pending = false;
    let opener = null;

    function fill(select, values, fallback) {
      select.textContent = '';
      [...new Set(values)].forEach((value) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value || fallback;
        select.append(option);
      });
    }

    fill(fields.product, [''], 'Choose a product');
    for (const item of products.values()) {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = item.name;
      fields.product.append(option);
    }

    function currentOption() {
      if (!product || !product.options.length) return null;
      if (mode === 'existing')
        return product.options.find(
          (option) =>
            (option.size || '') === fields.size.value &&
            (option.colour || '') === fields.colour.value,
        );
      const size = fields.newSize.value.trim().toLowerCase();
      const colour = fields.newColour.value.trim().toLowerCase();
      return product.options.find(
        (option) =>
          (option.size || '').toLowerCase() === size &&
          (option.colour || '').toLowerCase() === colour,
      );
    }

    function preview() {
      const option = currentOption();
      const current =
        mode === 'new'
          ? option?.stock || 0
          : option
            ? option.stock
            : product?.stock || 0;
      const raw = fields.units.value;
      const amount = Number(raw);
      const validAmount =
        /^\d{1,6}$/.test(raw) &&
        amount <= 100000 &&
        amount >= (action === 'count' ? 0 : 1);
      const next =
        action === 'count'
          ? amount
          : action === 'remove'
            ? current - amount
            : current + amount;
      const combinationValid =
        mode === 'existing'
          ? !product?.options.length || Boolean(option)
          : Boolean(
              fields.newSize.value.trim() || fields.newColour.value.trim(),
            );
      form.querySelector('[data-stock-before]').textContent = product
        ? String(current)
        : '—';
      form.querySelector('[data-stock-after]').textContent =
        validAmount && combinationValid && product ? String(next) : '—';
      const effect = form.querySelector('[data-stock-effect]');
      effect.textContent =
        mode === 'new'
          ? option
            ? 'This combination exists. Its stock will be increased.'
            : 'A new size / color combination will be created.'
          : action === 'count'
            ? 'This replaces the selected option’s stock with your physical count.'
            : '';
      if (validAmount && next < 0)
        effect.textContent = `Only ${current} units are available to remove.`;
      if (validAmount && next > 100000)
        effect.textContent = 'Stock cannot exceed 100,000 units.';
      submit.disabled =
        pending ||
        !product ||
        !validAmount ||
        !combinationValid ||
        next < 0 ||
        next > 100000 ||
        (action === 'count' && current === amount);
      submit.textContent =
        mode === 'new'
          ? option
            ? 'Restock combination'
            : 'Create & restock'
          : {
              add: 'Add stock',
              remove: 'Remove stock',
              count: 'Save stock count',
            }[action];
    }

    function updateAction(next) {
      action = next;
      form
        .querySelectorAll('[data-stock-op]')
        .forEach((button) =>
          button.setAttribute(
            'aria-pressed',
            String(button.dataset.stockOp === action),
          ),
        );
      fields.reason.value = {
        add: 'restock',
        remove: 'damage',
        count: 'stock_count',
      }[action];
      fields.units.min = action === 'count' ? '0' : '1';
      form.querySelector('[data-stock-amount-label]').textContent = {
        add: 'Units to add',
        remove: 'Units to remove',
        count: 'Physical stock count',
      }[action];
      preview();
    }

    function colours(preferred = '') {
      const options = product.options.filter(
        (option) => (option.size || '') === fields.size.value,
      );
      fill(
        fields.colour,
        options.map((option) => option.colour || ''),
        'Default',
      );
      if (options.some((option) => (option.colour || '') === preferred))
        fields.colour.value = preferred;
    }

    function updateMode(next) {
      const canCreate =
        product && (product.options.length || product.stock === 0);
      mode = next === 'new' && canCreate ? 'new' : 'existing';
      form.querySelectorAll('[data-stock-drawer-mode]').forEach((button) => {
        button.setAttribute(
          'aria-pressed',
          String(button.dataset.stockDrawerMode === mode),
        );
        if (button.dataset.stockDrawerMode === 'new')
          button.disabled = !canCreate;
      });
      form.querySelector('[data-stock-mode-hint]').hidden =
        !product || Boolean(canCreate);
      form.querySelector('[data-stock-mode-hint]').textContent =
        'This product has general stock. Assign its existing units to sizes and colors in Edit product before creating combinations.';
      form.querySelector('[data-stock-existing-dimensions]').hidden =
        mode !== 'existing' || !product?.options.length;
      form.querySelector('[data-stock-new-dimensions]').hidden = mode !== 'new';
      form.querySelector('[data-stock-general]').hidden =
        mode !== 'existing' || Boolean(product?.options.length);
      form.querySelector('[data-stock-operation]').hidden = mode === 'new';
      form.querySelector('[data-stock-reason-field]').hidden = mode === 'new';
      fields.units.value = '';
      updateAction('add');
    }

    function chooseProduct(id, variantId, nextMode = 'existing') {
      product = products.get(id) || null;
      fields.product.value = product ? product.id : '';
      section.hidden = !product;
      if (product) {
        const selected =
          product.options.find((option) => option.id === variantId) ||
          product.options[0];
        fill(
          fields.size,
          product.options.map((option) => option.size || ''),
          'Standard',
        );
        if (selected) fields.size.value = selected.size || '';
        colours(selected?.colour || '');
        fill(
          form.querySelector('[data-stock-size-suggestions]'),
          product.options.map((option) => option.size || '').filter(Boolean),
          '',
        );
        fill(
          form.querySelector('[data-stock-colour-suggestions]'),
          product.options.map((option) => option.colour || '').filter(Boolean),
          '',
        );
      }
      fields.newSize.value = '';
      fields.newColour.value = '';
      fields.note.value = '';
      updateMode(nextMode);
    }

    function closeDrawer() {
      dialog.close();
      delete form.dataset.unsaved;
      document.documentElement.classList.remove('stock-modal-open');
    }

    function requestClose() {
      if (pending) return;
      if (form.dataset.unsaved === 'true') {
        discard.hidden = false;
        form.querySelector('[data-stock-keep]').focus();
        return;
      }
      closeDrawer();
    }

    root.addEventListener(
      'click',
      (event) => {
        const bulk = event.target.closest('[data-stock-open-bulk]');
        if (bulk) {
          const panel = root.querySelector('[data-stock-bulk-tools] details');
          panel.open = true;
          panel.scrollIntoView({block: 'start'});
          panel.querySelector('summary').focus();
          return;
        }
        const button = event.target.closest('[data-inventory-edit]');
        if (!button) return;
        opener = button;
        form.reset();
        delete form.dataset.unsaved;
        discard.hidden = true;
        status.textContent = '';
        Nx.clearErrors(form);
        chooseProduct(
          button.dataset.inventoryEdit,
          button.dataset.inventoryOption,
          button.hasAttribute('data-inventory-new') ? 'new' : 'existing',
        );
        dialog.showModal();
        document.documentElement.classList.add('stock-modal-open');
        if (!product) fields.product.focus();
        else if (mode === 'new') fields.newSize.focus();
        else fields.units.focus();
      },
      {signal},
    );

    dialog.addEventListener(
      'click',
      (event) => {
        if (event.target.closest('[data-stock-close]')) requestClose();
        if (event.target.closest('[data-stock-keep]')) {
          discard.hidden = true;
          fields.units.focus();
        }
        if (event.target.closest('[data-stock-discard-confirm]') && !pending) {
          delete form.dataset.unsaved;
          closeDrawer();
        }
        const modeButton = event.target.closest('[data-stock-drawer-mode]');
        if (modeButton && !pending)
          updateMode(modeButton.dataset.stockDrawerMode);
        const operation = event.target.closest('[data-stock-op]');
        if (operation && !pending) {
          fields.units.value = '';
          updateAction(operation.dataset.stockOp);
        }
      },
      {signal},
    );
    dialog.addEventListener(
      'cancel',
      (event) => {
        event.preventDefault();
        requestClose();
      },
      {signal},
    );
    dialog.addEventListener(
      'keydown',
      (event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        requestClose();
      },
      {signal},
    );
    dialog.addEventListener(
      'close',
      () => {
        delete form.dataset.unsaved;
        document.documentElement.classList.remove('stock-modal-open');
        if (opener?.isConnected) opener.focus();
      },
      {signal},
    );
    form.addEventListener(
      'change',
      (event) => {
        if (event.target === fields.product)
          chooseProduct(fields.product.value);
        if (event.target === fields.size) colours(fields.colour.value);
        preview();
      },
      {signal},
    );
    form.addEventListener(
      'input',
      () => {
        form.dataset.unsaved = 'true';
        status.textContent = '';
        preview();
      },
      {signal},
    );
    form.addEventListener(
      'submit',
      async (event) => {
        event.preventDefault();
        if (
          pending ||
          !discard.hidden ||
          submit.disabled ||
          !product ||
          signal.aborted
        )
          return;
        const option = currentOption();
        const body = {
          action,
          units: Number(fields.units.value),
          reason: mode === 'new' ? 'restock' : fields.reason.value,
          note: fields.note.value.trim(),
        };
        if (mode === 'new')
          Object.assign(body, {
            size: fields.newSize.value.trim(),
            colour: fields.newColour.value.trim(),
          });
        else {
          if (option) body.optionId = option.id;
          if (action === 'count')
            body.expectedStock = option ? option.stock : product.stock;
        }
        const signature = JSON.stringify([product.id, body]);
        const key = `nx:inventory-drawer:${product.id}`;
        let reference;
        try {
          reference = JSON.parse(window.sessionStorage.getItem(key));
        } catch {
          /* Storage can be disabled. */
        }
        if (!reference || reference.signature !== signature)
          reference = {signature, id: window.crypto.randomUUID()};
        if (form.dataset.requestSignature !== signature) {
          form.dataset.requestSignature = signature;
          form.dataset.requestId = reference.id;
        }
        try {
          window.sessionStorage.setItem(
            key,
            JSON.stringify({signature, id: form.dataset.requestId}),
          );
        } catch {
          /* The form retains its reference. */
        }
        body.requestId = form.dataset.requestId;
        pending = true;
        form.dataset.pending = 'true';
        content.disabled = true;
        dialog.querySelectorAll('[data-stock-close]').forEach((button) => {
          button.disabled = true;
        });
        status.textContent = 'Saving stock…';
        let reply;
        try {
          reply = await Nx.submitForm(form, {
            url: `/api/admin/inventory/${encodeURIComponent(product.id)}${mode === 'new' ? '/combinations' : ''}`,
            method: mode === 'new' ? 'POST' : 'PATCH',
            body,
            busyLabel: 'Saving…',
          });
        } finally {
          pending = false;
          delete form.dataset.pending;
          content.disabled = false;
          dialog.querySelectorAll('[data-stock-close]').forEach((button) => {
            button.disabled = false;
          });
          preview();
        }
        if (!reply) {
          status.textContent =
            'Your values are kept. Retry to check this adjustment’s saved result.';
          form.querySelector('[aria-invalid="true"]')?.focus();
          return;
        }
        try {
          window.sessionStorage.removeItem(key);
        } catch {
          /* Storage can be disabled. */
        }
        delete form.dataset.unsaved;
        delete form.dataset.requestSignature;
        delete form.dataset.requestId;
        closeDrawer();
        Nx.toast(reply.message);
        if (window.NxNav) await window.NxNav.reload();
        else window.location.reload();
      },
      {signal},
    );
    signal.addEventListener(
      'abort',
      () => {
        if (dialog.open) closeDrawer();
        document.documentElement.classList.remove('stock-modal-open');
      },
      {once: true},
    );
  }

  window.NxInventoryEditor = {mount};
})();
