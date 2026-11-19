// Admin Inventory: type the new stock and press Save. Each changed field is sent as an exact count
// (PATCH /api/admin/inventory/:id); the server checks it, and the row shows what it saved.
(function () {
  'use strict';

  const Pages = window.NxPages;
  if (!Pages || !Pages.define) return;

  const PILL = {out: 'pill-red', low: 'pill-amber', healthy: 'pill-green'};
  const LABEL = {out: 'Out of stock', low: 'Low', healthy: 'In stock'};

  // Brings a row in line with the product the server sent back.
  function paint(row, product) {
    row.querySelector('[data-inv-stock]').textContent = String(product.stock);
    const state = row.querySelector('[data-inv-state]');
    state.textContent = LABEL[product.state];
    state.className = `pill ${PILL[product.state]}`;
    const stockOf = new Map(
      (product.options || []).map((option) => [option.id, option.stock]),
    );
    row.querySelectorAll('[data-inv-field]').forEach((field) => {
      const stock = field.dataset.optionId
        ? stockOf.get(field.dataset.optionId)
        : product.stock;
      field.value = field.dataset.stock = String(stock);
      field.classList.remove('is-changed');
    });
    row.querySelector('[data-inv-action]').value = 'count';
    const value = row.querySelector('[data-inv-value]');
    if (value)
      value.textContent = new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
      }).format(product.stockValue / 100);
    const history = row.querySelector('[data-stock-history]');
    if (history) {
      history.open = false;
      delete history.dataset.loaded;
    }
  }

  Pages.define('admin-inventory', (root, signal) => {
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
        if (field)
          field.classList.toggle(
            'is-changed',
            field.value !== field.dataset.stock,
          );
      },
      {signal},
    );

    root.addEventListener(
      'submit',
      async (event) => {
        const form = event.target.closest('[data-inv-form]');
        if (!form) return;
        event.preventDefault();
        const action = form.elements.action.value;
        const changed = [...form.querySelectorAll('[data-inv-field]')].filter(
          (field) =>
            action === 'count'
              ? field.value !== field.dataset.stock
              : Number(field.value) !== 0,
        );
        if (!changed.length) return;
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
        Nx.busy(button, true, 'Saving…');
        // Read every value first: the row is redrawn from the server's answer once at the end.
        const bodies = changed.map((field) => ({
          action,
          reason: form.elements.reason.value,
          note: form.elements.note.value.trim(),
          units: Number(field.value),
          ...(field.dataset.optionId ? {optionId: field.dataset.optionId} : {}),
        }));
        let reply = null;
        try {
          for (const body of bodies) {
            reply = await Nx.api(
              `/api/admin/inventory/${encodeURIComponent(form.dataset.invForm)}`,
              {method: 'PATCH', body},
            );
          }
          Nx.toast(
            bodies.length === 1
              ? reply.message
              : `${bodies.length} sizes saved. ${reply.product.name} now has ${reply.product.stock} in stock.`,
          );
        } catch (error) {
          Nx.toast(error.message, 'error');
        } finally {
          if (reply) paint(row, reply.product);
          Nx.busy(button, false);
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
