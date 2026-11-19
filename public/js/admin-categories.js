// Admin Categories: the list (show/hide, delete) and the create/edit form with its photo.
// Every rule is checked again on the server (utils/validators.js validateCategory and
// services/adminCategoryService.js), so this file only makes the screens pleasant.
(function () {
  'use strict';

  const Pages = window.NxPages;
  if (!Pages || !Pages.define) return;
  const go = (href) =>
    window.NxNav && window.NxNav.inArea(href)
      ? window.NxNav.go(href)
      : window.location.assign(href);
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  // ---------- The list ----------
  Pages.define('admin-categories', (root, signal) => {
    root.addEventListener(
      'click',
      async (event) => {
        const toggle = event.target.closest('[data-category-toggle]');
        const remove = event.target.closest('[data-category-delete]');
        if (toggle) await toggleListing(toggle);
        else if (remove) await deleteCategory(remove);
      },
      {signal},
    );

    async function toggleListing(button) {
      const id = button.dataset.categoryToggle;
      const listed = button.dataset.listed === 'true';
      const name = button.dataset.name;
      const count = Number(button.dataset.count) || 0;
      const ok = await Nx.confirm({
        title: listed ? `Hide ${name}?` : `Show ${name}?`,
        message: listed
          ? `${name} and its ${plural(count, 'product')} leave the store at once. Nothing is deleted, and you can show them again any time.`
          : `${name} and its listed products come back to the store.`,
        confirmLabel: listed ? 'Hide the category' : 'Show the category',
        tone: listed ? 'danger' : 'primary',
      });
      if (!ok) return;
      Nx.busy(button, true, listed ? 'Hiding…' : 'Showing…');
      try {
        const reply = await Nx.api(
          `/api/admin/categories/${encodeURIComponent(id)}/listing`,
          {method: 'PATCH', body: {isListed: !listed}},
        );
        Nx.busy(button, false);
        const now = reply.category.isListed;
        button.dataset.listed = String(now);
        button.textContent = now ? 'Hide' : 'Show';
        button.className = `btn btn-sm ${now ? 'btn-danger-soft' : 'btn-secondary'}`;
        button.setAttribute('aria-label', `${now ? 'Hide' : 'Show'} ${name}`);
        const row = button.closest('[data-category-row]');
        if (row) {
          row.classList.toggle('is-unlisted', !now);
          const pill = row.querySelector('[data-category-status]');
          if (pill) {
            pill.textContent = now ? 'In the store' : 'Hidden';
            pill.className = `pill ${now ? 'pill-green' : 'pill-grey'}`;
          }
        }
        Nx.toast(reply.message);
      } catch (error) {
        Nx.busy(button, false);
        Nx.toast(error.message, 'error');
      }
    }

    async function deleteCategory(button) {
      const id = button.dataset.categoryDelete;
      const name = button.dataset.name;
      const count = Number(button.dataset.count) || 0;
      // The server refuses too; saying so first saves a pointless confirm.
      if (count) {
        Nx.toast(
          `${name} still has ${plural(count, 'product')}. Move them to another category, or hide this one instead.`,
          'error',
        );
        return;
      }
      const ok = await Nx.confirm({
        title: `Delete ${name}?`,
        message: 'The category has no products, so nothing else changes.',
        confirmLabel: 'Delete the category',
      });
      if (!ok) return;
      Nx.busy(button, true, 'Deleting…');
      try {
        const reply = await Nx.api(
          `/api/admin/categories/${encodeURIComponent(id)}`,
          {method: 'DELETE'},
        );
        const row = button.closest('[data-category-row]');
        if (row) row.remove();
        Nx.toast(reply.message);
      } catch (error) {
        Nx.busy(button, false);
        Nx.toast(error.message, 'error');
      }
    }
  });

  // ---------- The create / edit form ----------
  Pages.define('admin-category-form', (root, signal) => {
    const form = root.querySelector('[data-category-form]');
    if (!form) return;

    // The link name preview follows the name until the admin types their own.
    const slugPreview = form.querySelector('[data-slug-preview]');
    const toSlug = (value) =>
      value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    const showSlug = () => {
      if (!slugPreview) return;
      slugPreview.textContent =
        toSlug(form.elements.slug.value) ||
        toSlug(form.elements.name.value) ||
        'running';
    };
    form.elements.name.addEventListener('input', showSlug, {signal});
    form.elements.slug.addEventListener('input', showSlug, {signal});

    // A picked photo shows straight away.
    const file = form.elements.image;
    const preview = form.querySelector('[data-photo-preview]');
    let previewUrl = '';
    file.addEventListener(
      'change',
      () => {
        const picked = file.files && file.files[0];
        if (!picked || !preview) return;
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = URL.createObjectURL(picked);
        preview.src = previewUrl;
        preview.alt = 'New photo';
        preview.hidden = false;
        if (form.elements.removeImage)
          form.elements.removeImage.checked = false;
      },
      {signal},
    );
    signal.addEventListener('abort', () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    });

    form.addEventListener(
      'submit',
      async (event) => {
        event.preventDefault();
        const body = new FormData(form);
        // An unchecked box is simply missing, so say what was meant either way.
        body.set('isListed', String(form.elements.isListed.checked));
        if (!(file.files && file.files.length)) body.delete('image');
        const reply = await Nx.submitForm(form, {
          url: form.dataset.endpoint,
          method: form.dataset.method,
          body,
          busyLabel: 'Saving…',
        });
        if (!reply) return;
        Nx.flash(reply.message);
        go(form.dataset.done);
      },
      {signal},
    );
  });
  // ---------- One category: move products in bulk ----------
  Pages.define('admin-category', (root, signal) => {
    const panel = root.querySelector('[data-category-products]');
    if (!panel) return;
    const bar = root.querySelector('[data-move-bar]');
    const countLabel = root.querySelector('[data-move-count]');
    const target = root.querySelector('[data-move-to]');
    const all = root.querySelector('[data-move-all]');
    const boxes = () => [...root.querySelectorAll('[data-move-pick]')];
    const chosen = () =>
      boxes()
        .filter((box) => box.checked)
        .map((box) => box.dataset.movePick);

    function update() {
      const n = chosen().length;
      bar.hidden = n === 0;
      countLabel.textContent = `${n} selected`;
      boxes().forEach((box) =>
        box.closest('tr').classList.toggle('is-selected', box.checked),
      );
      if (all) {
        all.checked = n > 0 && n === boxes().length;
        all.indeterminate = n > 0 && n < boxes().length;
      }
    }

    root.addEventListener(
      'change',
      (event) => {
        if (event.target === all)
          boxes().forEach((box) => {
            box.checked = all.checked;
          });
        if (event.target === all || event.target.matches('[data-move-pick]'))
          update();
      },
      {signal},
    );

    root.addEventListener(
      'click',
      async (event) => {
        if (event.target.closest('[data-move-clear]')) {
          boxes().forEach((box) => {
            box.checked = false;
          });
          update();
          return;
        }
        const button = event.target.closest('[data-move-apply]');
        if (!button) return;
        const ids = chosen();
        if (!target.value) {
          Nx.toast('Choose the category to move them to.', 'error');
          target.focus();
          return;
        }
        const name = target.selectedOptions[0].textContent;
        const ok = await Nx.confirm({
          title: `Move ${plural(ids.length, 'product')} to ${name}?`,
          message:
            'They take on the offer and visibility of that category, so their prices may change at once.',
          confirmLabel: 'Move them',
          tone: 'primary',
        });
        if (!ok) return;
        Nx.busy(button, true, 'Moving…');
        try {
          const reply = await Nx.api('/api/admin/categories/move-products', {
            method: 'POST',
            body: {productIds: ids, categoryId: target.value},
          });
          if (window.NxNav && window.NxNav.reload) {
            await window.NxNav.reload();
            Nx.toast(reply.message);
          } else {
            Nx.flash(reply.message);
            window.location.reload();
          }
        } catch (error) {
          Nx.busy(button, false);
          Nx.toast(error.message, 'error');
        }
      },
      {signal},
    );
    update();
  });
})();
