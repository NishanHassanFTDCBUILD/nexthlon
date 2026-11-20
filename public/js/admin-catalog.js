// Admin Inventory (views/admin/inventory.ejs).
//   - The side panel: Adjust (set, add or remove, one field per size, with a live "before → after"
//     preview), History (recent changes) and Reorder level. Esc, the backdrop and Cancel close it.
//   - The bulk bar: tick rows to restock them together or export only them.
//   - Import stock: ticked products or a CSV, always previewed before anything changes.
// Each change is one PATCH /api/admin/inventory/:id; the server checks it and the page shows what it saved.
(function () {
  'use strict';

  const Pages = window.NxPages;
  if (!Pages || !Pages.define) return;

  const PILL = {out: 'pill-red', low: 'pill-amber', healthy: 'pill-green'};
  const LABEL = {out: 'Out of stock', low: 'Low', healthy: 'In stock'};
  const MAX = 100000;
  const HINT = {
    count: 'Type the number you counted on the shelf.',
    add: 'Type how many units arrived. They are added to the current stock.',
    remove: 'Type how many units to take off (damaged, lost or sent back).',
  };
  // The reason picked for you when you choose an action (you can still change it).
  const DEFAULT_REASON = {
    count: 'stock_count',
    add: 'restock',
    remove: 'damage',
  };
  const REASON_LABEL = {
    restock: 'Restock',
    damage: 'Damage',
    return: 'Returned units',
    stock_count: 'Physical count',
    sale_correction: 'Sales correction',
    other: 'Other',
  };
  const money = (paise) =>
    new Intl.NumberFormat('en-IN', {style: 'currency', currency: 'INR'}).format(
      paise / 100,
    );
  const byId = (root, attr, id) =>
    root.querySelector(`[${attr}="${CSS.escape(id)}"]`);

  Pages.define('admin-inventory', (root, signal) => {
    const drawer = root.querySelector('[data-inv-drawer]');
    const backdrop = root.querySelector('.inv-backdrop');
    const dialog = root.querySelector('[data-inv-import]');
    const bulkBar = root.querySelector('[data-inv-bulk]');
    let openId = null;
    let lastFocus = null;

    // ---------- The row and the panel follow what the server saved ----------
    function paint(product) {
      const row = byId(root, 'data-inv-row', product.id);
      const sheet = byId(root, 'data-inv-sheet', product.id);
      for (const place of [row, sheet].filter(Boolean)) {
        place.querySelectorAll('[data-inv-stock]').forEach((el) => {
          el.textContent = String(product.stock);
        });
        place.querySelectorAll('[data-inv-state]').forEach((el) => {
          el.textContent = LABEL[product.state];
          el.className = `pill ${PILL[product.state]}`;
        });
      }
      if (row) {
        const value = row.querySelector('[data-inv-value]');
        if (value) value.textContent = money(product.stockValue);
        const wrap = row.querySelector('[data-inv-bar-wrap]');
        if (wrap) {
          wrap.className = `inv-bar is-${product.state}`;
          const full = Number(wrap.dataset.full) || 1;
          wrap.querySelector('[data-inv-bar]').style.width =
            `${Math.min(100, Math.round((product.stock / full) * 100))}%`;
        }
      }
      if (!sheet) return;
      const stockOf = new Map(
        (product.options || []).map((option) => [option.id, option.stock]),
      );
      sheet.querySelectorAll('[data-inv-field]').forEach((field) => {
        const stock = field.dataset.optionId
          ? stockOf.get(field.dataset.optionId)
          : product.stock;
        field.dataset.stock = String(stock);
        const now = field
          .closest('[data-inv-line]')
          .querySelector('[data-inv-now]');
        if (now) now.textContent = String(stock);
      });
      const form = sheet.querySelector('[data-inv-form]');
      resetFields(form);
      const history = sheet.querySelector('[data-stock-history]');
      if (history) delete history.dataset.loaded;
    }

    // ---------- Adjust: fields, steppers and the live preview ----------
    const actionOf = (form) => form.elements.action.value;

    function resetFields(form) {
      const action = actionOf(form);
      form.querySelectorAll('[data-inv-field]').forEach((field) => {
        field.value = action === 'count' ? field.dataset.stock : '0';
        field.classList.remove('is-changed');
      });
      updatePreview(form);
    }

    // What each line will become, and a one-line summary of the whole change.
    function updatePreview(form) {
      const action = actionOf(form);
      let changed = 0;
      let bad = false;
      let before = 0;
      let after = 0;
      form.querySelectorAll('[data-inv-line]').forEach((line) => {
        const field = line.querySelector('[data-inv-field]');
        const preview = line.querySelector('[data-inv-preview]');
        const now = Number(field.dataset.stock);
        const typed = field.value.trim();
        const n = /^\d{1,6}$/.test(typed) ? Number(typed) : NaN;
        const result =
          action === 'count' ? n : action === 'add' ? now + n : now - n;
        const moves = action === 'count' ? n !== now : n > 0;
        field.classList.toggle('is-changed', moves);
        preview.className = 'inv-preview';
        before += now;
        if (Number.isNaN(n)) {
          preview.textContent = 'Whole number';
          preview.classList.add('is-bad');
          bad = true;
          after += now;
          return;
        }
        if (!moves) {
          preview.textContent = '';
          after += now;
          return;
        }
        if (result < 0 || result > MAX) {
          preview.textContent = result < 0 ? `Only ${now}` : 'Too many';
          preview.classList.add('is-bad');
          bad = true;
          after += now;
          return;
        }
        changed += 1;
        after += result;
        preview.textContent = `${now} → ${result}`;
        preview.classList.add(result > now ? 'is-up' : 'is-down');
      });
      const summary = form.querySelector('[data-inv-summary]');
      summary.className = 'inv-summary';
      if (bad) {
        summary.textContent = 'Fix the highlighted number before saving.';
        summary.classList.add('is-bad');
      } else if (!changed) {
        summary.textContent = 'Change a number to see what will be saved.';
      } else {
        const lines = form.querySelectorAll('[data-inv-line]').length;
        const what =
          lines > 1
            ? `${changed} ${changed === 1 ? 'size' : 'sizes'}`
            : 'stock';
        summary.textContent = `Saving changes ${what}: ${before} → ${after} units in total.`;
        summary.classList.add('is-ready');
      }
      return {changed, bad};
    }

    root.addEventListener(
      'change',
      (event) => {
        const radio = event.target.closest('[data-inv-action]');
        if (radio) {
          const form = radio.form;
          const reason = form.elements.reason;
          // Pick a matching reason, unless one was chosen by hand.
          if (!reason.value || reason.dataset.auto === 'true') {
            reason.value = DEFAULT_REASON[radio.value];
            reason.dataset.auto = 'true';
          }
          form.querySelector('[data-inv-hint]').textContent = HINT[radio.value];
          resetFields(form);
          return;
        }
        if (event.target.matches('[data-inv-form] select[name="reason"]'))
          event.target.dataset.auto = 'false';
        if (
          event.target.matches(
            '[data-inventory-select], [data-inventory-select-all]',
          )
        )
          onSelect(event.target);
      },
      {signal},
    );

    root.addEventListener(
      'input',
      (event) => {
        const field = event.target.closest('[data-inv-field]');
        if (field) updatePreview(field.form);
      },
      {signal},
    );

    // ---------- Opening and closing the panel ----------
    function selectTab(sheet, name, {focus = false} = {}) {
      sheet.querySelectorAll('[data-inv-tab-btn]').forEach((button) => {
        const on = button.dataset.invTabBtn === name;
        button.setAttribute('aria-selected', String(on));
        button.tabIndex = on ? 0 : -1;
        if (on && focus) button.focus();
      });
      sheet.querySelectorAll('[data-inv-pane]').forEach((pane) => {
        pane.hidden = pane.dataset.invPane !== name;
      });
      if (name === 'history') loadHistory(sheet);
    }

    function openSheet(id, tab = 'adjust') {
      const sheet = byId(root, 'data-inv-sheet', id);
      if (!sheet || !drawer) return;
      lastFocus = document.activeElement;
      openId = id;
      root.querySelectorAll('[data-inv-sheet]').forEach((each) => {
        each.hidden = each !== sheet;
      });
      drawer.setAttribute('aria-label', `Manage stock: ${sheet.dataset.name}`);
      drawer.hidden = false;
      backdrop.hidden = false;
      document.documentElement.classList.add('inv-drawer-open');
      selectTab(sheet, tab);
      const form = sheet.querySelector('[data-inv-form]');
      resetFields(form);
      requestAnimationFrame(() => {
        drawer.classList.add('is-open');
        const first =
          tab === 'adjust'
            ? sheet.querySelector('[data-inv-field]')
            : sheet.querySelector(`[data-inv-tab-btn="${tab}"]`);
        if (first) {
          first.focus();
          if (first.select) first.select();
        } else drawer.focus();
      });
    }

    function closeSheet() {
      if (!drawer || drawer.hidden) return;
      drawer.classList.remove('is-open');
      drawer.hidden = true;
      backdrop.hidden = true;
      document.documentElement.classList.remove('inv-drawer-open');
      openId = null;
      if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
    }
    signal.addEventListener('abort', () =>
      document.documentElement.classList.remove('inv-drawer-open'),
    );

    root.addEventListener(
      'click',
      (event) => {
        const open = event.target.closest('[data-inv-open]');
        if (open) {
          openSheet(open.dataset.invOpen, open.dataset.invTab || 'adjust');
          return;
        }
        if (event.target.closest('[data-inv-close]')) {
          closeSheet();
          return;
        }
        const tab = event.target.closest('[data-inv-tab-btn]');
        if (tab) {
          selectTab(tab.closest('[data-inv-sheet]'), tab.dataset.invTabBtn);
          return;
        }
        const step = event.target.closest('[data-inv-step]');
        if (step) {
          const field = step
            .closest('.inv-stepper')
            .querySelector('[data-inv-field]');
          const current = Number(field.value) || 0;
          field.value = String(
            Math.max(0, Math.min(MAX, current + Number(step.dataset.invStep))),
          );
          updatePreview(field.form);
        }
      },
      {signal},
    );

    // Esc closes; Tab stays inside the open panel; arrow keys move between its tabs.
    document.addEventListener(
      'keydown',
      (event) => {
        if (!drawer || drawer.hidden) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          closeSheet();
          return;
        }
        const tab =
          event.target.closest && event.target.closest('[data-inv-tab-btn]');
        if (tab && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
          const tabs = [
            ...tab.parentElement.querySelectorAll('[data-inv-tab-btn]'),
          ];
          const next =
            tabs[
              (tabs.indexOf(tab) +
                (event.key === 'ArrowRight' ? 1 : -1) +
                tabs.length) %
                tabs.length
            ];
          selectTab(tab.closest('[data-inv-sheet]'), next.dataset.invTabBtn, {
            focus: true,
          });
          event.preventDefault();
          return;
        }
        if (event.key !== 'Tab') return;
        const focusable = [
          ...drawer.querySelectorAll(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
          ),
        ].filter((el) => !el.disabled && el.offsetParent !== null);
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          last.focus();
          event.preventDefault();
        } else if (!event.shiftKey && document.activeElement === last) {
          first.focus();
          event.preventDefault();
        }
      },
      {signal},
    );

    // ---------- History ----------
    async function loadHistory(sheet) {
      const box = sheet.querySelector('[data-stock-history]');
      if (!box || box.dataset.loaded) return;
      const content = box.querySelector('[data-history-content]');
      content.textContent = 'Loading recent changes…';
      try {
        const result = await Nx.api(
          `/api/admin/inventory/${encodeURIComponent(box.dataset.stockHistory)}/history`,
        );
        if (signal.aborted) return;
        content.textContent = '';
        if (!result.entries.length) {
          content.textContent = 'No stock changes recorded yet.';
        } else {
          const list = document.createElement('ol');
          list.className = 'inv-history-list';
          for (const entry of result.entries) {
            const item = document.createElement('li');
            const change = document.createElement('strong');
            const up = Number(entry.after) >= Number(entry.before);
            change.className = up ? 'is-up' : 'is-down';
            change.textContent = `${entry.before} → ${entry.after}`;
            const what = document.createElement('span');
            what.textContent = [
              entry.option,
              REASON_LABEL[entry.reason] || entry.reason,
              entry.note,
            ]
              .filter(Boolean)
              .join(' · ');
            const when = document.createElement('span');
            when.className = 'muted';
            when.textContent = `${new Date(entry.at).toLocaleString('en-IN', {
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            })} · ${entry.actor}`;
            item.append(change, what, when);
            list.append(item);
          }
          content.append(list);
        }
        box.dataset.loaded = 'true';
      } catch (error) {
        content.textContent = `${error.message} Open the tab again to retry.`;
      }
    }

    // ---------- Saving a change ----------
    root.addEventListener(
      'submit',
      async (event) => {
        const form = event.target.closest('[data-inv-form]');
        if (!form) return;
        event.preventDefault();
        const {changed, bad} = updatePreview(form);
        if (bad) {
          const wrong = form.querySelector('.inv-preview.is-bad');
          const field =
            wrong &&
            wrong.closest('[data-inv-line]').querySelector('[data-inv-field]');
          if (field) field.focus();
          return;
        }
        if (!changed) {
          Nx.toast('Nothing to save yet. Change a number first.', 'error');
          return;
        }
        if (!form.elements.reason.value) {
          Nx.toast('Choose a reason for this change.', 'error');
          form.elements.reason.focus();
          return;
        }
        const action = actionOf(form);
        const fields = [...form.querySelectorAll('[data-inv-field]')].filter(
          (field) =>
            action === 'count'
              ? field.value !== field.dataset.stock
              : Number(field.value) > 0,
        );
        const button = form.querySelector('[type="submit"]');
        Nx.busy(button, true, 'Saving…');
        // Read every value first: the panel is redrawn from the server's answer once at the end.
        const bodies = fields.map((field) => ({
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
          if (!signal.aborted) {
            if (reply) {
              paint(reply.product);
              form.elements.note.value = '';
              const summary = form.querySelector('[data-inv-summary]');
              summary.textContent = `Saved. Stock is now ${reply.product.stock}.`;
              summary.className = 'inv-summary is-ready';
            }
            Nx.busy(button, false);
          }
        }
      },
      {signal},
    );

    // ---------- Ticking rows: the bulk bar ----------
    const boxes = () => [...root.querySelectorAll('[data-inventory-select]')];
    const ticked = () => boxes().filter((box) => box.checked);

    function onSelect(target) {
      if (target.matches('[data-inventory-select-all]'))
        boxes().forEach((box) => {
          box.checked = target.checked;
        });
      const all = root.querySelector('[data-inventory-select-all]');
      const chosen = ticked();
      if (all) {
        all.checked = chosen.length > 0 && chosen.length === boxes().length;
        all.indeterminate = chosen.length > 0 && chosen.length < boxes().length;
      }
      boxes().forEach((box) =>
        box.closest('tr').classList.toggle('is-selected', box.checked),
      );
      if (!bulkBar) return;
      bulkBar.hidden = chosen.length === 0;
      bulkBar.querySelector('[data-inv-bulk-count]').textContent =
        `${chosen.length} selected`;
      bulkBar.querySelector('[data-inv-bulk-export]').href =
        `/api/admin/inventory/export.csv?ids=${chosen
          .map((box) => encodeURIComponent(box.dataset.inventorySelect))
          .join(',')}`;
    }

    root.addEventListener(
      'click',
      (event) => {
        if (event.target.closest('[data-inv-bulk-clear]')) {
          boxes().forEach((box) => {
            box.checked = false;
          });
          const all = root.querySelector('[data-inventory-select-all]');
          if (all) all.checked = false;
          onSelect(all || boxes()[0] || root);
          return;
        }
        if (event.target.closest('[data-inv-bulk-restock]'))
          openImport('selected');
        else if (event.target.closest('[data-inv-import-open]'))
          openImport(ticked().length ? 'selected' : 'csv');
      },
      {signal},
    );

    // ---------- Import stock (dialog) ----------
    let batchId = null;
    let previewRows = [];
    const previewPanel = root.querySelector('[data-import-preview]');
    const applyButton = root.querySelector('[data-import-apply]');
    const errorButton = root.querySelector('[data-import-errors]');
    const refreshButton = root.querySelector('[data-import-refresh]');

    function importTab(name) {
      dialog.querySelectorAll('[data-inv-import-tab]').forEach((button) => {
        const on = button.dataset.invImportTab === name;
        button.setAttribute('aria-selected', String(on));
        button.classList.toggle('is-active', on);
        button.tabIndex = on ? 0 : -1;
      });
      dialog.querySelectorAll('[data-inv-import-pane]').forEach((pane) => {
        pane.hidden = pane.dataset.invImportPane !== name;
      });
    }

    function openImport(tab) {
      if (!dialog) return;
      const chosen = ticked();
      const sized = chosen.filter((box) => box.dataset.hasSizes === 'true');
      const note = dialog.querySelector('[data-inv-import-selected]');
      note.textContent = !chosen.length
        ? 'Tick products in the table first, then come back here.'
        : `${chosen.length - sized.length} of ${chosen.length} selected products will be restocked.` +
          (sized.length
            ? ` ${sized.length} with sizes are skipped: use their Adjust panel or the CSV file.`
            : '');
      importTab(tab);
      previewPanel.hidden = true;
      batchId = null;
      if (!dialog.open) dialog.showModal();
      const first = dialog.querySelector(
        `[data-inv-import-pane="${tab}"] input:not([type="hidden"])`,
      );
      if (first) first.focus();
    }

    if (dialog) {
      dialog.addEventListener(
        'click',
        (event) => {
          if (
            event.target === dialog ||
            event.target.closest('[data-inv-import-close]')
          ) {
            dialog.close();
            return;
          }
          const tab = event.target.closest('[data-inv-import-tab]');
          if (tab) importTab(tab.dataset.invImportTab);
        },
        {signal},
      );
    }

    const showPreview = (reply, skipped) => {
      batchId = reply.batchId;
      previewRows = reply.rows;
      const body = root.querySelector('[data-import-rows]');
      body.textContent = '';
      for (const row of reply.rows) {
        const tr = document.createElement('tr');
        for (const [label, value] of Object.entries({
          Row: row.row,
          Product: row.name || row.productId,
          'Units to add': row.units,
          Reason: REASON_LABEL[row.reason] || row.reason,
          Result: Object.values(row.errors).join('; ') || 'Ready',
        })) {
          const td = document.createElement('td');
          td.dataset.label = label;
          td.textContent = String(value ?? '');
          tr.append(td);
        }
        body.append(tr);
      }
      root.querySelector('[data-import-summary]').textContent =
        (reply.valid
          ? `${reply.rows.length} stock rows are ready. Check the units, then confirm.`
          : 'Nothing changed. Correct the errors, then preview again.') +
        (skipped ? ` ${skipped} products with sizes were skipped.` : '');
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
        Nx.busy(button, true, 'Preparing preview…');
        try {
          let body;
          let skipped = 0;
          if (form.matches('[data-inventory-csv]')) {
            const file = form.elements.csv.files[0];
            if (!file || file.size > 10000)
              throw new Error('Choose a CSV of 10 KB or less.');
            body = {csv: await file.text()};
          } else {
            const units = form.elements.units.value.trim();
            if (
              !/^\d{1,6}$/.test(units) ||
              Number(units) < 1 ||
              Number(units) > MAX
            )
              throw new Error('Enter how many units to add (1 to 100,000).');
            const chosen = ticked();
            const plain = chosen.filter(
              (box) => box.dataset.hasSizes !== 'true',
            );
            skipped = chosen.length - plain.length;
            if (!plain.length)
              throw new Error(
                chosen.length
                  ? 'The selected products have sizes. Use their Adjust panel or the CSV file.'
                  : 'Tick products in the table first.',
              );
            body = {
              rows: plain.map((box) => ({
                productId: box.dataset.inventorySelect,
                units,
                reason: form.elements.reason.value,
                note: form.elements.note.value,
              })),
            };
          }
          const reply = await Nx.api('/api/admin/inventory/restock/preview', {
            method: 'POST',
            body,
          });
          if (!signal.aborted) showPreview(reply, skipped);
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
          if (dialog && dialog.open) dialog.close();
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
        Nx.busy(applyButton, true, 'Applying restock…');
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
            `${applied} rows applied. ${reply.results.length - applied} need review. Refresh the list to see the new stock.`;
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

    // A panel left open by Back/Forward is closed when the section is swapped out.
    signal.addEventListener('abort', () => {
      if (openId) closeSheet();
    });
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
