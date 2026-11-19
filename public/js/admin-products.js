// Admin products: list filters, list/unlist toggle, and the add/edit form with its photo manager.
(function () {
  'use strict';

  const MAX_IMAGES = 4;
  const MAX_BYTES = 2 * 1024 * 1024;
  const TYPES = ['image/jpeg', 'image/png', 'image/webp'];
  const STATUS = {
    active: {label: 'Active', pill: 'pill-green'},
    unlisted: {label: 'Unlisted', pill: 'pill-grey'},
    out: {label: 'Out of stock', pill: 'pill-red'},
  };

  function iconSvg(name) {
    return `<svg class="i i-xs" aria-hidden="true"><use href="/img/icons.svg#${name}"></use></svg>`;
  }

  // ---------- List page ----------
  // (The filter form is a GET form: section-nav.js loads its results without a reload.)
  window.NxPages.define('admin-products', (root, signal) => {
    root.addEventListener(
      'change',
      (event) => {
        const field = event.target.closest(
          '[data-admin-filters] [data-auto-submit-field]',
        );
        if (field) field.form.requestSubmit();
      },
      {signal},
    );

    root.addEventListener(
      'click',
      async (event) => {
        const button = event.target.closest('[data-toggle-listing]');
        if (!button) return;
        const listed = button.dataset.listed === 'true';
        const name = button.dataset.name;
        const confirmed = await Nx.confirm({
          title: listed ? `Unlist ${name}?` : `List ${name} again?`,
          message: listed
            ? 'Shoppers will no longer see it, and it shows as unavailable in carts. It stays here, so you can list it again any time.'
            : 'It will be visible in the store again straight away.',
          confirmLabel: listed ? 'Unlist product' : 'List product',
          tone: listed ? 'danger' : 'primary',
        });
        if (!confirmed) return;

        Nx.busy(button, true, listed ? 'Unlisting…' : 'Listing…');
        try {
          const result = await Nx.api(
            `/api/admin/products/${encodeURIComponent(button.dataset.toggleListing)}/listing`,
            {
              method: 'PATCH',
              body: {isListed: !listed},
            },
          );
          Nx.busy(button, false);
          const product = result.product;
          const row = button.closest('tr');
          const status = row.querySelector('[data-status]');
          status.textContent = STATUS[product.status].label;
          status.className = `pill ${STATUS[product.status].pill}`;
          row.classList.toggle('is-unlisted', !product.isListed);
          button.dataset.listed = String(product.isListed);
          button.textContent = product.isListed ? 'Unlist' : 'List';
          button.setAttribute(
            'aria-label',
            `${product.isListed ? 'Unlist' : 'List'} ${name}`,
          );
          button.className = `btn btn-sm ${product.isListed ? 'btn-danger-soft' : 'btn-secondary'}`;
          Nx.toast(result.message);
        } catch (error) {
          Nx.busy(button, false);
          Nx.toast(error.message, 'error');
        }
      },
      {signal},
    );
  });

  // ---------- Add / edit form ----------
  // Its elements live inside the section, so their listeners go away with it.
  window.NxPages.define('admin-product-form', (root) => {
    const form = root.querySelector('[data-product-form]');
    if (!form) return;

    // Live discount preview. The server works out the real value when saving.
    const priceInput = form.querySelector('[data-price]');
    const mrpInput = form.querySelector('[data-mrp]');
    const preview = form.querySelector('[data-discount-preview]');
    function updateDiscount() {
      const price = Number(priceInput.value);
      const mrp = Number(mrpInput.value);
      if (!price || !mrp) preview.textContent = '—';
      else if (mrp < price)
        preview.textContent = 'M.R.P. is lower than the price';
      else
        preview.textContent =
          mrp > price
            ? `${Math.round(((mrp - price) / mrp) * 100)}% off`
            : 'No discount';
    }
    priceInput.addEventListener('input', updateDiscount);
    mrpInput.addEventListener('input', updateDiscount);
    updateDiscount();

    // Photo manager. Each item is a photo already saved ("kept") or a file picked just now ("new").
    const manager = form.querySelector('[data-image-manager]');
    const tiles = manager.querySelector('[data-image-tiles]');
    const input = manager.querySelector('[data-image-input]');
    const addTile = manager.querySelector('[data-image-add]');
    const countLabel = manager.querySelector('[data-image-count]');
    const imageError = form.querySelector('[data-error-for="images"]');
    let nextId = 0;
    // Each photo can belong to one colour (B3): the product page shows that colour's photos when it is picked.
    const savedColours = new Map(
      JSON.parse(manager.dataset.colourPhotos || '[]').map((row) => [
        row.image,
        row.colour,
      ]),
    );
    const items = JSON.parse(manager.dataset.existing || '[]').map((url) => ({
      id: nextId++,
      kind: 'kept',
      url,
      src: url,
      colour: savedColours.get(url) || '',
    }));
    // The colours typed in the "Sizes and colours" table, read live so a new colour can be chosen at once.
    const productColours = () => [
      ...new Set(
        [...form.querySelectorAll('[data-option-field="colour"]')]
          .map((field) => field.value.trim())
          .filter(Boolean),
      ),
    ];
    let mainId = items.length ? items[0].id : null;

    function showImageError(message) {
      imageError.textContent = message;
    }

    function render() {
      tiles.textContent = '';
      if (!items.some((item) => item.id === mainId))
        mainId = items.length ? items[0].id : null;
      items.forEach((item, index) => {
        const li = document.createElement('li');
        li.className = `image-tile${item.id === mainId ? ' is-main' : ''}`;
        const img = document.createElement('img');
        img.src = item.src;
        img.alt = `Photo ${index + 1}`;
        img.width = 160;
        img.height = 160;
        li.append(img);
        if (item.edited) {
          const tag = document.createElement('span');
          tag.className = 'image-edited-badge';
          tag.textContent = 'Edited';
          li.append(tag);
        }

        const bar = document.createElement('div');
        bar.className = 'image-tile-bar';
        if (item.id === mainId) {
          const badge = document.createElement('span');
          badge.className = 'image-main-badge';
          badge.innerHTML = `${iconSvg('check')} Main photo`;
          bar.append(badge);
        } else {
          const makeMain = document.createElement('button');
          makeMain.type = 'button';
          makeMain.className = 'link-btn';
          makeMain.textContent = 'Make main';
          makeMain.setAttribute(
            'aria-label',
            `Make photo ${index + 1} the main photo`,
          );
          makeMain.addEventListener('click', () => {
            mainId = item.id;
            render();
          });
          bar.append(makeMain);
        }
        const edit = document.createElement('button');
        edit.type = 'button';
        edit.className = 'icon-btn icon-btn-sm image-edit';
        edit.dataset.editId = String(item.id);
        edit.setAttribute(
          'aria-label',
          `Edit photo ${index + 1}: crop, rotate or replace`,
        );
        edit.title = 'Edit photo';
        edit.innerHTML = iconSvg('edit');
        edit.addEventListener('click', () => editPhoto(item, index, edit));
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'icon-btn icon-btn-sm image-remove';
        remove.setAttribute('aria-label', `Remove photo ${index + 1}`);
        remove.innerHTML = iconSvg('trash');
        remove.addEventListener('click', () => {
          items.splice(items.indexOf(item), 1);
          showImageError('');
          render();
        });
        const colours = productColours();
        if (colours.length) {
          // A photo of a colour that was removed from the table goes back to "every colour".
          if (item.colour && !colours.includes(item.colour)) item.colour = '';
          const pick = document.createElement('select');
          pick.className = 'image-colour';
          pick.setAttribute('aria-label', `Colour shown in photo ${index + 1}`);
          pick.append(
            new Option('Every colour', ''),
            ...colours.map((colour) => new Option(colour, colour)),
          );
          pick.value = item.colour || '';
          pick.addEventListener('change', () => {
            item.colour = pick.value;
          });
          li.append(pick);
        }
        const actions = document.createElement('span');
        actions.className = 'image-tile-actions';
        actions.append(edit, remove);
        bar.append(actions);
        li.append(bar);
        tiles.append(li);
      });
      addTile.hidden = items.length >= MAX_IMAGES;
      countLabel.textContent = `${items.length} of ${MAX_IMAGES} added`;
    }

    // The editor (public/js/image-editor.js) is loaded the first time it is needed.
    let editorLoading = null;
    function loadEditor() {
      if (window.NxImageEditor) return Promise.resolve(window.NxImageEditor);
      if (!editorLoading) {
        editorLoading = new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = manager.dataset.editorSrc;
          script.onload = () =>
            window.NxImageEditor
              ? resolve(window.NxImageEditor)
              : reject(new Error('missing'));
          script.onerror = () =>
            reject(new Error('The photo editor could not be loaded.'));
          document.head.append(script);
        }).catch((error) => {
          editorLoading = null;
          throw error;
        });
      }
      return editorLoading;
    }

    // An edited photo becomes a new upload in the same place (and stays the main photo if it was).
    // The old file is deleted only when the product is saved.
    async function editPhoto(item, index, button) {
      showImageError('');
      let editor;
      try {
        Nx.busy(button, true, '');
        editor = await loadEditor();
      } catch (error) {
        Nx.toast(error.message, 'error');
        return;
      } finally {
        Nx.busy(button, false);
      }
      const result = await editor.open({
        url: item.kind === 'kept' ? item.url : '',
        file: item.kind === 'new' ? item.file : null,
        label: `Photo ${index + 1}`,
      });
      if (result && items.includes(item)) {
        Object.assign(item, {
          kind: 'new',
          file: result.file,
          src: result.src,
          edited: true,
        });
        delete item.url;
        render();
        Nx.toast('Photo updated. Save the product to keep the change.');
      }
      const again = tiles.querySelector(`[data-edit-id="${item.id}"]`);
      if (again) again.focus();
    }

    // Previews use data: URLs, which the Content Security Policy already allows for images.
    function readPreview(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
    }

    input.addEventListener('change', async () => {
      const files = [...input.files];
      input.value = '';
      showImageError('');
      for (const file of files) {
        if (items.length >= MAX_IMAGES) {
          showImageError(`A product can have up to ${MAX_IMAGES} photos.`);
          break;
        }
        if (!TYPES.includes(file.type)) {
          showImageError(`${file.name} is not a JPG, PNG or WEBP image.`);
          continue;
        }
        if (file.size > MAX_BYTES) {
          showImageError(`${file.name} is larger than 2 MB.`);
          continue;
        }
        try {
          items.push({
            id: nextId++,
            kind: 'new',
            file,
            src: await readPreview(file),
          });
        } catch {
          showImageError(`${file.name} could not be read.`);
        }
      }
      render();
    });

    // ---------- Sizes and colours ----------
    // Rows of size / colour / SKU / stock. With any rows, the stock field shows their total and is locked.
    const optionsBox = form.querySelector('[data-options-editor]');
    const optionsTable = optionsBox.querySelector('[data-options-table]');
    const optionRows = optionsBox.querySelector('[data-options-rows]');
    const stockTotal = form.querySelector('[data-stock-total]');
    const stockHint = form.querySelector('[data-stock-hint]');
    let rowNumber = 0;
    function cell(name, value, label, attrs) {
      const td = document.createElement('td');
      const field = document.createElement('input');
      Object.assign(field, {
        value: value === undefined ? '' : String(value),
        ...attrs,
      });
      field.setAttribute('aria-label', label);
      field.dataset.optionField = name;
      td.append(field);
      return td;
    }
    function syncOptions() {
      const rows = [...optionRows.children];
      optionsTable.hidden = rows.length === 0;
      stockTotal.readOnly = rows.length > 0;
      stockHint.hidden = rows.length === 0;
      if (rows.length) {
        stockTotal.value = String(
          rows.reduce(
            (sum, row) =>
              sum +
              (Math.max(
                0,
                Math.round(
                  Number(
                    row.querySelector('[data-option-field="stock"]').value,
                  ),
                ),
              ) || 0),
            0,
          ),
        );
      }
    }
    function addOptionRow(option = {}, focus = false) {
      rowNumber += 1;
      const tr = document.createElement('tr');
      tr.dataset.optionId = option.id || '';
      tr.append(
        cell('size', option.size, `Size, row ${rowNumber}`, {
          maxLength: 20,
          placeholder: 'e.g. 9',
        }),
        cell('colour', option.colour, `Colour, row ${rowNumber}`, {
          maxLength: 30,
          placeholder: 'e.g. Black',
        }),
        cell('sku', option.sku, `SKU, row ${rowNumber}`, {
          maxLength: 40,
          placeholder: 'e.g. TF2-BLK-9',
        }),
        cell(
          'stock',
          option.stock === undefined ? 0 : option.stock,
          `Stock, row ${rowNumber}`,
          {type: 'number', min: 0, step: 1, inputMode: 'numeric'},
        ),
      );
      const td = document.createElement('td');
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'icon-btn icon-btn-sm';
      remove.setAttribute('aria-label', 'Remove this row');
      remove.innerHTML = iconSvg('trash');
      remove.addEventListener('click', () => {
        const next = tr.nextElementSibling || tr.previousElementSibling;
        tr.remove();
        syncOptions();
        (next
          ? next.querySelector('input')
          : optionsBox.querySelector('[data-option-add]')
        ).focus();
      });
      td.append(remove);
      tr.append(td);
      optionRows.append(tr);
      syncOptions();
      if (focus) tr.querySelector('input').focus();
    }
    optionsBox.addEventListener('input', (event) => {
      if (event.target.dataset.optionField === 'stock') syncOptions();
    });
    // A colour typed or removed in the table updates the colour choice on each photo.
    optionsBox.addEventListener('change', (event) => {
      if (event.target.dataset.optionField === 'colour') render();
    });
    optionsBox
      .querySelector('[data-option-add]')
      .addEventListener('click', () => addOptionRow({}, true));
    optionsBox.querySelectorAll('[data-option-preset]').forEach((button) => {
      button.addEventListener('click', () => {
        const have = new Set(
          [...optionRows.querySelectorAll('[data-option-field="size"]')].map(
            (field) => field.value.trim().toLowerCase(),
          ),
        );
        button.dataset.optionPreset
          .split(',')
          .filter((size) => !have.has(size.toLowerCase()))
          .forEach((size) => addOptionRow({size, stock: 0}));
      });
    });
    JSON.parse(optionsBox.dataset.options || '[]').forEach((option) =>
      addOptionRow(option),
    );
    const readOptions = () =>
      [...optionRows.children].map((row) => {
        const read = (name) =>
          row.querySelector(`[data-option-field="${name}"]`).value.trim();
        return {
          id: row.dataset.optionId,
          size: read('size'),
          colour: read('colour'),
          sku: read('sku'),
          stock: read('stock'),
        };
      });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      // Everything is checked on the server, which reports every problem at once (photos included).
      const data = new FormData();
      for (const name of [
        'name',
        'description',
        'category',
        'brand',
        'price',
        'mrp',
        'offerPercent',
        'stock',
        'hsn',
        'gstRate',
        'gstRateAbove',
        'gstAbove',
        'countryOfOrigin',
        'manufacturer',
        'netQuantity',
        'shipWeight',
        'sku',
      ]) {
        data.append(name, form.elements[name].value);
      }
      data.append('options', JSON.stringify(readOptions()));
      const kept = items.filter((item) => item.kind === 'kept');
      const fresh = items.filter((item) => item.kind === 'new');
      data.append('keepImages', JSON.stringify(kept.map((item) => item.url)));
      // The order on screen, so an edited photo keeps its place.
      data.append(
        'imageOrder',
        JSON.stringify(
          items.map((item) =>
            item.kind === 'kept' ? item.url : `new:${fresh.indexOf(item)}`,
          ),
        ),
      );
      data.append(
        'photoColours',
        JSON.stringify(items.map((item) => item.colour || '')),
      );
      fresh.forEach((item) => data.append('images', item.file, item.file.name));
      const main = items.find((item) => item.id === mainId);
      if (main)
        data.append(
          'mainImage',
          main.kind === 'kept' ? main.url : `new:${fresh.indexOf(main)}`,
        );

      const result = await Nx.submitForm(form, {
        url: form.dataset.endpoint,
        method: form.dataset.method,
        body: data,
        busyLabel: 'Saving…',
      });
      if (result) {
        const list = `${document.body.dataset.adminPath}/products`;
        if (window.NxNav)
          window.NxNav.go(list).then(() => Nx.toast(result.message));
        else {
          Nx.flash(result.message);
          window.location.assign(list);
        }
      }
    });

    render();
  });
})();
