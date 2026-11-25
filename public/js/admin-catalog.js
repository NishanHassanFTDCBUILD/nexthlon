// Admin Inventory: manage existing stock or create a size/color combination in one editor.
// The server validates every movement; saved rows and overview totals use its response.
(function () {
  'use strict';

  const Pages = window.NxPages;
  if (!Pages || !Pages.define) return;

  const PILL = {out: 'pill-red', low: 'pill-amber', healthy: 'pill-green'};
  const LABEL = {out: 'Out of stock', low: 'Low', healthy: 'In stock'};
  function syncStockEditor(form) {
    const picker = form.querySelector('[data-stock-option]');
    if (!picker || !picker.options) return;
    const sizePicker = form.querySelector('[data-stock-size]');
    const colourPicker = form.querySelector('[data-stock-colour]');
    if (sizePicker && colourPicker) {
      const chosen = picker.selectedOptions[0];
      sizePicker.value = chosen.dataset.size || '';
      colourPicker.textContent = '';
      const colours = [
        ...new Set(
          [...picker.options]
            .filter(
              (option) => (option.dataset.size || '') === sizePicker.value,
            )
            .map((option) => option.dataset.colour || ''),
        ),
      ];
      colours.forEach((colour) => {
        const option = document.createElement('option');
        option.value = colour;
        option.textContent = colour || 'Default';
        colourPicker.append(option);
      });
      colourPicker.value = chosen.dataset.colour || '';
    }
    const action = form.elements.action.value;
    let selected;
    form.querySelectorAll('[data-inv-field]').forEach((field) => {
      const active = (field.dataset.optionId || '') === picker.value;
      field.closest('[data-stock-quantity]').hidden = !active;
      if (active) selected = field;
    });
    if (!selected) return;
    const current = Number(selected.dataset.stock);
    const units = Number(selected.value);
    const next =
      action === 'count'
        ? units
        : action === 'add'
          ? current + units
          : current - units;
    form.querySelectorAll('[data-stock-quantity-label]').forEach((label) => {
      label.textContent =
        action === 'count'
          ? 'New total count'
          : action === 'add'
            ? 'Units to add'
            : 'Units to remove';
    });
    form.querySelector('[data-stock-save-label]').textContent =
      action === 'count'
        ? 'Save corrected count'
        : action === 'add'
          ? 'Add stock'
          : 'Remove stock';
    form.querySelector('[data-stock-preview]').textContent =
      Number.isInteger(units) && units >= 0
        ? next < 0
          ? `Only ${current} available. Reduce the quantity to remove.`
          : `${current} available → ${next} after saving`
        : `Current stock: ${current}`;
  }

  // Brings a row in line with the product the server sent back.
  function paint(row, product, action = 'count') {
    row.querySelector('[data-inv-stock]').textContent = String(product.stock);
    const state = row.querySelector('[data-inv-state]');
    state.textContent = LABEL[product.state];
    state.className = `pill ${PILL[product.state]}`;
    const stockOf = new Map(
      (product.options || []).map((option) => [option.id, option.stock]),
    );
    const variantRows = row.querySelectorAll('[data-stock-variant]');
    variantRows.forEach((variantRow) => {
      if (!variantRow.dataset || variantRow.dataset.stockVariant === undefined)
        return;
      const option = (product.options || []).find(
        (item) => item.id === variantRow.dataset.stockVariant,
      );
      const quantity = option ? option.stock : product.stock;
      variantRow.querySelector('[data-variant-quantity]').textContent =
        String(quantity);
      const badge = variantRow.querySelector('[data-variant-status]');
      const state = option ? option.state : product.state;
      badge.textContent = LABEL[state];
      badge.className = `pill ${PILL[state]}`;
    });
    row.querySelectorAll('[data-inv-field]').forEach((field) => {
      const stock = field.dataset.optionId
        ? stockOf.get(field.dataset.optionId)
        : product.stock;
      field.value = field.dataset.stock = String(stock);
      field.classList.remove('is-changed');
    });
    row.querySelector('[data-inv-action]').value = 'count';
    const editor = row.querySelector('[data-existing-stock]');
    if (editor && editor.elements) {
      editor.elements.action.value = action;
      editor.querySelectorAll('[data-inv-field]').forEach((field) => {
        field.value = action === 'count' ? field.dataset.stock : '0';
      });
      const picker = editor.querySelector('[data-stock-option]');
      for (const option of picker.options) {
        const entry = (product.options || []).find(
          (item) => item.id === option.value,
        );
        option.textContent = `${entry ? entry.label : 'General stock'} · ${entry ? entry.stock : product.stock} available`;
      }
      syncStockEditor(editor);
    }
    const value = row.querySelector('[data-inv-value]');
    if (value)
      value.textContent = new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
      }).format(product.stockValue / 100);
    const pace = row.querySelector('[data-inv-pace]');
    if (pace && product.soldLast30 !== undefined)
      pace.textContent =
        product.soldLast30 +
        ' sold in 30 days · ' +
        (product.daysOfCover === null
          ? 'no recent sales'
          : 'about ' + product.daysOfCover + ' days of stock left');
    const flag = row.querySelector('[data-inv-reorder-flag]');
    if (flag && product.needsReorder !== undefined)
      flag.hidden = !product.needsReorder;
    const updated = row.querySelector('[data-inv-updated]');
    if (updated && product.updatedAt)
      updated.textContent = new Date(product.updatedAt).toLocaleString(
        'en-IN',
        {timeZone: 'Asia/Kolkata'},
      );
    const history = row.querySelector('[data-stock-history]');
    if (history) {
      history.open = false;
      delete history.dataset.loaded;
    }
  }

  Pages.define('admin-inventory', (root, signal) => {
    if (window.NxInventoryEditor) window.NxInventoryEditor.mount(root, signal);
    const pendingStockForms = new WeakSet();
    root.addEventListener(
      'click',
      (event) => {
        const button = event.target.closest('[data-edit-stock-option]');
        if (!button) return;
        const card = button.closest('[data-inv-row]');
        const form = card.querySelector('[data-existing-stock]');
        if (card.querySelector('[data-pending="true"]')) return;
        const mode = card.querySelector('[data-stock-mode]');
        mode.value = 'existing';
        mode.dispatchEvent(new Event('change', {bubbles: true}));
        const picker = form.querySelector('[data-stock-option]');
        picker.value = button.dataset.editStockOption;
        picker.dispatchEvent(new Event('change', {bubbles: true}));
        const field = [...form.querySelectorAll('[data-inv-field]')].find(
          (input) => (input.dataset.optionId || '') === picker.value,
        );
        field.focus();
        card
          .querySelectorAll('[data-stock-variant]')
          .forEach((variant) =>
            variant.classList.toggle(
              'is-selected',
              variant.dataset.stockVariant === picker.value,
            ),
          );
      },
      {signal},
    );
    root.addEventListener(
      'change',
      (event) => {
        const mode = event.target.closest('[data-stock-mode]');
        if (mode) {
          const panel = mode.closest('[data-stock-editor]');
          if (panel.querySelector('[data-pending="true"]')) {
            mode.value = mode.value === 'new' ? 'existing' : 'new';
            return;
          }
          panel.querySelector('[data-existing-stock]').hidden =
            mode.value !== 'existing';
          panel.querySelector('[data-restock-combination]').hidden =
            mode.value !== 'new';
          return;
        }
        const picker = event.target.closest('[data-stock-option]');
        const dimension = event.target.closest(
          '[data-stock-size], [data-stock-colour]',
        );
        if (dimension) {
          const form = dimension.form;
          const options = form.querySelector('[data-stock-option]');
          const size = form.querySelector('[data-stock-size]').value;
          const colour = form.querySelector('[data-stock-colour]').value;
          const choices = [...options.options].filter(
            (option) => (option.dataset.size || '') === size,
          );
          const selected =
            choices.find(
              (option) => (option.dataset.colour || '') === colour,
            ) || choices[0];
          if (selected) {
            options.value = selected.value;
            options.dispatchEvent(new Event('change', {bubbles: true}));
          }
          return;
        }
        if (!picker) return;
        picker.form.querySelectorAll('[data-inv-field]').forEach((field) => {
          field.value =
            picker.form.elements.action.value === 'count'
              ? field.dataset.stock
              : '0';
        });
        syncStockEditor(picker.form);
      },
      {signal},
    );
    const stockRequests = new WeakMap();
    const pendingCombinations = new WeakSet();
    root.addEventListener(
      'input',
      (event) => {
        const form = event.target.closest('[data-restock-combination]');
        if (form) form.dataset.unsaved = 'true';
      },
      {signal},
    );
    root.addEventListener(
      'submit',
      async (event) => {
        const form = event.target.closest('[data-restock-combination]');
        if (!form) return;
        event.preventDefault();
        if (pendingCombinations.has(form) || signal.aborted) return;
        const body = {
          size: form.elements.size.value.trim(),
          colour: form.elements.colour.value.trim(),
          units: form.elements.units.value,
          note: form.elements.note.value.trim(),
        };
        const status = form.querySelector('[data-combination-status]');
        if (
          (!body.size && !body.colour) ||
          !/^\d{1,6}$/.test(body.units) ||
          Number(body.units) < 1 ||
          Number(body.units) > 100000
        ) {
          status.textContent =
            'Enter a size or color and a whole quantity from 1 to 100,000.';
          return;
        }
        const signature = JSON.stringify(body);
        const storageKey = `nx:combination:${form.dataset.restockCombination}`;
        let request;
        try {
          request = JSON.parse(window.sessionStorage.getItem(storageKey));
        } catch {
          /* Storage may be disabled. */
        }
        if (!request || request.signature !== signature)
          request = {signature, id: window.crypto.randomUUID()};
        try {
          window.sessionStorage.setItem(storageKey, JSON.stringify(request));
        } catch {
          /* The form retains the reference for a retry. */
        }
        if (form.dataset.requestSignature !== signature) {
          form.dataset.requestSignature = signature;
          form.dataset.requestId = request.id;
        }
        body.requestId = form.dataset.requestId;
        pendingCombinations.add(form);
        form.dataset.pending = 'true';
        status.textContent = 'Saving combination and stock…';
        const controls = [...form.querySelectorAll('input, button')].map(
          (control) => ({control, disabled: control.disabled}),
        );
        controls.forEach(({control}) => {
          control.disabled = true;
        });
        let reply;
        try {
          reply = await Nx.submitForm(form, {
            url: `/api/admin/inventory/${encodeURIComponent(form.dataset.restockCombination)}/combinations`,
            method: 'POST',
            body,
            busyLabel: 'Restocking…',
          });
        } finally {
          pendingCombinations.delete(form);
          delete form.dataset.pending;
          controls.forEach(({control, disabled}) => {
            control.disabled = disabled;
          });
        }
        if (!reply) {
          status.textContent =
            'Restock could not be confirmed. Your values are kept for retry.';
          return;
        }
        delete form.dataset.unsaved;
        delete form.dataset.requestSignature;
        delete form.dataset.requestId;
        try {
          window.sessionStorage.removeItem(storageKey);
        } catch {
          /* Storage may be disabled. */
        }
        status.textContent = reply.message;
        form.elements.units.value = '';
        Nx.toast(reply.message);
        if (window.NxNav) await window.NxNav.reload();
        else window.location.reload();
      },
      {signal},
    );
    let importPending = false;
    let batchId = null;
    let previewRows = [];
    const previewPanel = root.querySelector('[data-import-preview]');
    const applyButton = root.querySelector('[data-import-apply]');
    const errorButton = root.querySelector('[data-import-errors]');
    const refreshButton = root.querySelector('[data-import-refresh]');
    const showPreview = (reply) => {
      batchId = reply.batchId;
      previewRows = reply.rows;
      const body = root.querySelector('[data-import-rows]');
      body.textContent = '';
      for (const row of reply.rows) {
        const tr = document.createElement('tr');
        for (const [label, value] of Object.entries({
          'CSV row': row.row,
          Product: row.name || row.productId,
          'Units to add': row.units,
          Reason: row.reason,
          'Errors / result': Object.values(row.errors).join('; ') || 'Ready',
        })) {
          const td = document.createElement('td');
          td.dataset.label = label;
          td.textContent = String(value ?? '');
          tr.append(td);
        }
        body.append(tr);
      }
      root.querySelector('[data-import-summary]').textContent = reply.valid
        ? `${reply.rows.length} stock rows are ready. Review the units before confirming.`
        : 'Nothing changed. Correct the errors, then preview again.';
      applyButton.hidden = !reply.valid;
      errorButton.hidden = reply.valid;
      refreshButton.hidden = true;
      previewPanel.hidden = false;
      previewPanel.focus();
    };
    root.addEventListener(
      'submit',
      async (event) => {
        const form = event.target.closest(
          '[data-inventory-bulk], [data-inventory-csv]',
        );
        if (!form) return;
        event.preventDefault();
        if (importPending) return;
        importPending = true;
        const button = form.querySelector('[type="submit"]');
        batchId = null;
        applyButton.hidden = true;
        Nx.busy(button, true, 'Preparing preview...');
        try {
          let body;
          if (form.matches('[data-inventory-csv]')) {
            const file = form.elements.csv.files[0];
            if (!file || file.size > 10000)
              throw new Error('Choose a CSV of 10 KB or less.');
            body = {csv: await file.text()};
          } else {
            const ids = [
              ...root.querySelectorAll('[data-inventory-select]:checked'),
            ].map((box) => box.dataset.inventorySelect);
            if (!ids.length)
              throw new Error(
                'Select products using the checkboxes in the stock table. Products with sizes use the CSV import.',
              );
            body = {
              rows: ids.map((productId) => ({
                productId,
                units: form.elements.units.value,
                reason: form.elements.reason.value,
                note: form.elements.note.value,
              })),
            };
          }
          const reply = await Nx.api('/api/admin/inventory/restock/preview', {
            method: 'POST',
            body,
          });
          if (!signal.aborted) showPreview(reply);
        } catch (error) {
          Nx.toast(error.message, 'error');
        } finally {
          importPending = false;
          if (!signal.aborted) Nx.busy(button, false);
        }
      },
      {signal},
    );
    root.addEventListener(
      'click',
      async (event) => {
        if (event.target.closest('[data-import-refresh]')) {
          if (window.NxNav) await window.NxNav.reload();
          else window.location.reload();
          return;
        }
        if (event.target.closest('[data-import-errors]')) {
          const csvCell = (value) => {
            const text = String(value ?? '');
            return (
              '"' +
              (/^[=+\-@\t\r]/.test(text) ? "'" : '') +
              text.replaceAll('"', '""') +
              '"'
            );
          };
          const data = [
            ['row', 'productId', 'errors'],
            ...previewRows
              .filter((row) => Object.keys(row.errors).length)
              .map((row) => [
                row.row,
                row.productId,
                Object.values(row.errors).join('; '),
              ]),
          ];
          const url = URL.createObjectURL(
            new Blob(
              [data.map((row) => row.map(csvCell).join(',')).join('\r\n')],
              {type: 'text/csv;charset=utf-8'},
            ),
          );
          const link = document.createElement('a');
          link.href = url;
          link.download = 'restock-errors.csv';
          document.body.append(link);
          link.click();
          link.remove();
          URL.revokeObjectURL(url);
          return;
        }
        if (!event.target.closest('[data-import-apply]') || !batchId) return;
        if (importPending) return;
        importPending = true;
        Nx.busy(applyButton, true, 'Applying restock...');
        try {
          const reply = await Nx.api(
            `/api/admin/inventory/restock/${encodeURIComponent(batchId)}/apply`,
            {method: 'POST', body: {}},
          );
          if (signal.aborted) return;
          const applied = reply.results.filter(
            (row) => row.status === 'applied',
          ).length;
          previewRows = previewRows.map((row, index) => ({
            ...row,
            errors:
              reply.results[index]?.status === 'review'
                ? {result: reply.results[index].message}
                : {},
          }));
          errorButton.hidden = applied === reply.results.length;
          refreshButton.hidden = false;
          batchId = null;
          applyButton.hidden = true;
          root.querySelector('[data-import-summary]').textContent =
            `${applied} rows applied. ${reply.results.length - applied} need review. Refresh the list to see current stock.`;
          const cells = root.querySelectorAll('[data-import-rows] tr');
          reply.results.forEach((row, index) => {
            if (cells[index])
              cells[index].lastElementChild.textContent = row.message;
          });
          Nx.toast(`${applied} stock rows applied.`);
        } catch (error) {
          Nx.toast(error.message, 'error');
        } finally {
          importPending = false;
          if (!signal.aborted) Nx.busy(applyButton, false);
        }
      },
      {signal},
    );
    root.addEventListener(
      'change',
      (event) => {
        if (event.target.matches('[data-inventory-select-all]')) {
          root
            .querySelectorAll('[data-inventory-select]:not(:disabled)')
            .forEach((box) => {
              box.checked = event.target.checked;
            });
        }
        if (
          event.target.matches(
            '[data-inventory-select], [data-inventory-select-all]',
          )
        ) {
          const boxes = [
            ...root.querySelectorAll('[data-inventory-select]:not(:disabled)'),
          ];
          const selected = boxes.filter((box) => box.checked).length;
          const all = root.querySelector('[data-inventory-select-all]');
          if (all) {
            all.checked = selected > 0 && selected === boxes.length;
            all.indeterminate = selected > 0 && selected < boxes.length;
          }
        }
        const action = event.target.closest('[data-inv-action]');
        if (!action) return;
        action.form.querySelectorAll('[data-inv-field]').forEach((field) => {
          field.value = action.value === 'count' ? field.dataset.stock : '0';
        });
        action.form.elements.reason.value = {
          add: 'restock',
          remove: 'damage',
          count: 'stock_count',
        }[action.value];
        syncStockEditor(action.form);
      },
      {signal},
    );
    root.addEventListener(
      'toggle',
      async (event) => {
        const details = event.target;
        if (
          !details.matches('[data-stock-history]') ||
          !details.open ||
          details.dataset.loaded
        )
          return;
        const content = details.querySelector('[data-history-content]');
        content.textContent = 'Loading adjustments...';
        try {
          const result = await Nx.api(
            `/api/admin/inventory/${encodeURIComponent(details.dataset.stockHistory)}/history`,
          );
          if (signal.aborted) return;
          content.textContent = '';
          if (!result.entries.length)
            content.textContent = 'No recorded adjustments.';
          for (const entry of result.entries) {
            const line = document.createElement('p');
            line.textContent = `${new Date(entry.at).toLocaleString('en-IN')} / ${entry.actor}: ${entry.before} to ${entry.after}. ${entry.option} ${entry.reason}. ${entry.note}`;
            content.append(line);
          }
          details.dataset.loaded = 'true';
        } catch (error) {
          content.textContent = error.message + ' Close and reopen to retry.';
        }
      },
      {capture: true, signal},
    );
    // A field that differs from the saved stock is marked, so it is clear what Save will send.
    root.addEventListener(
      'input',
      (event) => {
        const field = event.target.closest('[data-inv-field]');
        if (field) {
          const form = field.closest('[data-inv-form]');
          if (form) form.dataset.unsaved = 'true';
          if (form) syncStockEditor(form);
          field.classList.toggle(
            'is-changed',
            field.value !== field.dataset.stock,
          );
        }
      },
      {signal},
    );

    root.addEventListener(
      'submit',
      async (event) => {
        const form = event.target.closest('[data-inv-form]');
        if (!form) return;
        event.preventDefault();
        if (pendingStockForms.has(form) || signal.aborted) return;
        const status = form.querySelector('[data-inv-save-status]');
        if (!form.elements.reason.value) {
          if (status) status.textContent = 'Choose a reason before saving.';
          form.elements.reason.focus();
          return;
        }
        const action = form.elements.action.value;
        const changed = [...form.querySelectorAll('[data-inv-field]')].filter(
          (field) =>
            action === 'count'
              ? field.value !== field.dataset.stock
              : Number(field.value) !== 0,
        );
        if (!changed.length) {
          if (status) status.textContent = 'No stock changes to save.';
          return;
        }
        const invalid = changed.find(
          (field) =>
            !/^\d{1,6}$/.test(field.value) || Number(field.value) > 100000,
        );
        if (invalid) {
          Nx.toast('Enter a whole number from 0 to 100,000.', 'error');
          invalid.focus();
          return;
        }
        const row = form.closest('[data-inv-row]');
        const button = form.querySelector('[type="submit"]');
        pendingStockForms.add(form);
        form.dataset.pending = 'true';
        if (status) status.textContent = 'Saving stock adjustment…';
        const controls = [...form.querySelectorAll('input, select')].map(
          (control) => ({control, disabled: control.disabled}),
        );
        controls.forEach(({control}) => {
          control.disabled = true;
        });
        Nx.busy(button, true, 'Saving…');
        // Read every value first: the row is redrawn from the server's answer once at the end.
        const bodies = changed.map((field) => {
          const body = {
            action,
            reason: form.elements.reason.value,
            note: form.elements.note.value.trim(),
            units: Number(field.value),
            ...(action === 'count'
              ? {expectedStock: Number(field.dataset.stock)}
              : {}),
            ...(field.dataset.optionId
              ? {optionId: field.dataset.optionId}
              : {}),
          };
          const signature = JSON.stringify(body);
          const storageKey = `nx:stock:${form.dataset.invForm}:${field.dataset.optionId || 'total'}`;
          let pending = stockRequests.get(field);
          if (!pending) {
            try {
              pending = JSON.parse(window.sessionStorage.getItem(storageKey));
            } catch {
              /* Storage can be disabled. */
            }
          }
          if (!pending || pending.signature !== signature) {
            pending = {signature, requestId: window.crypto.randomUUID()};
            stockRequests.set(field, pending);
          }
          try {
            window.sessionStorage.setItem(storageKey, JSON.stringify(pending));
          } catch {
            /* Keep the in-memory reference. */
          }
          return {...body, requestId: pending.requestId};
        });
        let reply = null;
        let saved = 0;
        let failed = false;
        try {
          for (const body of bodies) {
            reply = await Nx.api(
              `/api/admin/inventory/${encodeURIComponent(form.dataset.invForm)}`,
              {method: 'PATCH', body},
            );
            if (reply.totals)
              root.querySelectorAll('[data-inv-total]').forEach((total) => {
                const key = total.dataset.invTotal;
                total.textContent =
                  key === 'value'
                    ? Nx.formatPrice(reply.totals[key])
                    : Number(reply.totals[key]).toLocaleString('en-IN');
              });
            stockRequests.delete(changed[saved]);
            try {
              window.sessionStorage.removeItem(
                `nx:stock:${form.dataset.invForm}:${changed[saved].dataset.optionId || 'total'}`,
              );
            } catch {
              /* Storage can be disabled. */
            }
            saved++;
          }
          Nx.toast(
            bodies.length === 1
              ? reply.message
              : `${bodies.length} sizes saved. ${reply.product.name} now has ${reply.product.stock} in stock.`,
          );
          if (status)
            status.textContent = 'Adjustment saved. Stock overview updated.';
        } catch (error) {
          failed = true;
          if (status)
            status.textContent = `${saved ? saved + (saved === 1 ? ' change saved. ' : ' changes saved. ') : ''}${error.message} Entered quantities are kept. Retry the same adjustment to check its saved result.`;
          Nx.toast(error.message, 'error');
        } finally {
          delete form.dataset.pending;
          if (!failed) delete form.dataset.unsaved;
          if (reply) paint(row, reply.product, action);
          if (failed && reply) {
            form.elements.action.value = action;
            if (action !== 'count')
              form.querySelectorAll('[data-inv-field]').forEach((field) => {
                field.value = '0';
              });
            changed.slice(saved).forEach((field, index) => {
              field.value = String(bodies[saved + index].units);
              field.classList.add('is-changed');
            });
          }
          controls.forEach(({control, disabled}) => {
            control.disabled = disabled;
          });
          Nx.busy(button, false);
          pendingStockForms.delete(form);
        }
      },
      {signal},
    );
  });

  // ---------- Reorder level: save it, or go back to the store-wide level ----------
  // Delegated on the document so it also works after the section is swapped in without a reload.
  function saveReorder(productId, value) {
    return Nx.api(
      `/api/admin/inventory/${encodeURIComponent(productId)}/reorder`,
      {method: 'PATCH', body: {reorderLevel: value}},
    ).then((reply) => {
      Nx.toast(reply.message);
      window.setTimeout(() => window.location.reload(), 600);
      return reply;
    });
  }
  document.addEventListener('submit', (event) => {
    const form = event.target.closest('[data-reorder-form]');
    if (!form) return;
    event.preventDefault();
    const raw = form.elements.reorderLevel.value.trim();
    if (raw !== '' && !/^\d{1,6}$/.test(raw)) {
      Nx.toast(
        'Enter a whole number, or leave it empty for the store-wide level.',
        'error',
      );
      return;
    }
    saveReorder(
      form.dataset.reorderForm,
      raw === '' ? null : Number(raw),
    ).catch((error) => Nx.toast(error.message, 'error'));
  });
  document.addEventListener('click', (event) => {
    const clear = event.target.closest('[data-reorder-clear]');
    if (!clear) return;
    const form = clear.closest('[data-reorder-form]');
    if (!form) return;
    saveReorder(form.dataset.reorderForm, null).catch((error) =>
      Nx.toast(error.message, 'error'),
    );
  });
})();
