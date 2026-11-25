// Admin Sales sections: orders (filters, bulk status, column picker), one order (status, cancel,
// shipments, notes, refunds, return decisions), returns, transactions and refunds.
// Each section is a window.NxPages module, so it keeps working after no-reload section switches.
(function () {
  'use strict';

  const Pages = window.NxPages;
  if (!Pages || !Pages.define) return;
  const refresh = (message) => {
    if (window.NxNav)
      return window.NxNav.reload().then(() => message && Nx.toast(message));
    if (message) Nx.flash(message);
    window.location.reload();
    return Promise.resolve();
  };

  // ---------- Orders ----------
  Pages.define('admin-orders', (root, signal) => {
    const bar = root.querySelector('[data-bulk-bar]');
    let bulkPending = false;

    // Bulk select.
    const boxes = () => [...root.querySelectorAll('[data-select]')];
    const selected = () =>
      boxes()
        .filter((box) => box.checked)
        .map((box) => box.dataset.select);
    const showBar = () => {
      const ids = selected();
      bar.hidden = ids.length === 0;
      bar.querySelector('[data-bulk-count]').textContent =
        `${ids.length} selected`;
      const all = root.querySelector('[data-select-all]');
      if (all) {
        all.checked = ids.length > 0 && ids.length === boxes().length;
        all.indeterminate = ids.length > 0 && ids.length < boxes().length;
      }
      boxes().forEach((box) =>
        box.closest('tr').classList.toggle('is-selected', box.checked),
      );
    };
    root.addEventListener(
      'change',
      (event) => {
        if (event.target.matches('[data-select-all]'))
          boxes().forEach((box) => {
            box.checked = event.target.checked;
          });
        if (event.target.matches('[data-select-all], [data-select]')) showBar();
      },
      {signal},
    );
    root.addEventListener(
      'click',
      async (event) => {
        if (event.target.closest('[data-bulk-clear]')) {
          boxes().forEach((box) => {
            box.checked = false;
          });
          showBar();
          return;
        }
        const apply = event.target.closest('[data-bulk-apply]');
        if (!apply || bulkPending) return;
        const status = bar.querySelector('[data-bulk-status]').value;
        const orderIds = selected();
        if (!orderIds.length)
          return Nx.toast('Select at least one order first.', 'error');
        if (!status)
          return Nx.toast('Choose the status to move the orders to.', 'error');
        const label = bar.querySelector(
          `[data-bulk-status] option[value="${status}"]`,
        ).textContent;
        bulkPending = true;
        try {
          const ok = await Nx.confirm({
            title: `Move ${orderIds.length} ${orderIds.length === 1 ? 'order' : 'orders'} to ${label}?`,
            message:
              "Orders only move forward. Any order that can't take this step is skipped and listed.",
            confirmLabel: 'Move orders',
            tone: 'primary',
          });
          if (!ok || signal.aborted) return;
          Nx.busy(apply, true, 'Moving…');
          try {
            const reply = await Nx.api('/api/admin/orders/bulk-status', {
              method: 'POST',
              body: {orderIds, status},
            });
            await refresh(reply.message);
            if (reply.skipped.length)
              Nx.toast(
                `Skipped: ${reply.skipped.map((s) => `${s.orderId} (${s.reason})`).join('; ')}`,
                'error',
              );
          } catch (error) {
            Nx.busy(apply, false);
            Nx.toast(error.message, 'error');
          }
        } finally {
          bulkPending = false;
          Nx.busy(apply, false);
        }
      },
      {signal},
    );
  });

  // ---------- One order ----------
  Pages.define('admin-order', (root, signal) => {
    const holder = root.querySelector('[data-admin-order]');
    if (!holder) return;
    const id = encodeURIComponent(holder.dataset.adminOrder);
    const api = (path) => `/api/admin/orders/${id}${path}`;
    const pendingForms = new WeakSet();

    async function send(form, {url, method = 'POST', body, confirm, busy}) {
      if (pendingForms.has(form) || signal.aborted) return;
      pendingForms.add(form);
      try {
        if (confirm && !(await Nx.confirm(confirm))) return;
        if (signal.aborted) return;
        const reply = await Nx.submitForm(form, {
          url,
          method,
          body,
          busyLabel: busy,
        });
        if (reply && !signal.aborted) await refresh(reply.message);
      } finally {
        pendingForms.delete(form);
      }
    }

    const cancelForm = root.querySelector('[data-cancel-form]');
    if (cancelForm) {
      const chosen = () => [
        ...cancelForm.querySelectorAll('input[name="itemIds"]'),
      ];
      const updateSelection = () => {
        const boxes = chosen();
        const count = boxes.filter((box) => box.checked).length;
        const master = cancelForm.querySelector('[data-cancel-select-all]');
        const label = cancelForm.querySelector('[data-cancel-count]');
        const submit = cancelForm.querySelector('[data-cancel-submit]');
        if (master) {
          master.checked = count > 0 && count === boxes.length;
          master.indeterminate = count > 0 && count < boxes.length;
        }
        if (label) label.textContent = count + ' selected';
        if (submit) submit.disabled = count === 0;
      };
      cancelForm.addEventListener(
        'change',
        (event) => {
          if (event.target.matches('[data-cancel-select-all]'))
            chosen().forEach((box) => {
              box.checked = event.target.checked;
            });
          updateSelection();
        },
        {signal},
      );
      updateSelection();
    }

    root.addEventListener(
      'submit',
      (event) => {
        const form = event.target;
        if (form.matches('[data-order-tags]')) {
          event.preventDefault();
          send(form, {
            url: api('/tags'),
            method: 'PATCH',
            body: {
              tags: [
                ...form.querySelectorAll('input[name="tags"]:checked'),
              ].map((input) => input.value),
            },
            busy: 'Saving labels.',
          });
        } else if (form.matches('[data-status-form]')) {
          event.preventDefault();
          const select = form.elements.status;
          const label = select.options[select.selectedIndex].textContent;
          send(form, {
            url: api('/status'),
            method: 'PATCH',
            body: {status: select.value},
            busy: 'Updating…',
            confirm: {
              title: `Move this order to "${label}"?`,
              message:
                "Orders only move forward. The customer's order page updates straight away.",
              confirmLabel: 'Update status',
              tone: 'primary',
            },
          });
        } else if (form.matches('[data-cancel-form]')) {
          event.preventDefault();
          const itemIds = [
            ...form.querySelectorAll("input[name='itemIds']:checked"),
          ].map((box) => box.value);
          if (!itemIds.length) {
            Nx.toast('Select the items you want to cancel first.', 'error');
            return;
          }
          const values = Nx.formValues(form);
          send(form, {
            url: api('/cancel'),
            body: {
              itemIds,
              reason: values.reason,
              refundMethod: 'wallet',
            },
            busy: 'Cancelling…',
            confirm: {
              title: itemIds.length
                ? `Cancel ${itemIds.length} ${itemIds.length === 1 ? 'item' : 'items'}?`
                : 'Cancel every item that can still be cancelled?',
              message:
                'Stock goes back on the shelf, and anything already paid is credited to the customer’s Nexthlon wallet.',
              confirmLabel: 'Cancel items',
            },
          });
        } else if (form.matches('[data-shipment-form]')) {
          event.preventDefault();
          const values = Nx.formValues(form);
          send(form, {url: api('/shipments'), body: values, busy: 'Saving…'});
        } else if (form.matches('[data-ship-now-form]')) {
          event.preventDefault();
          send(form, {
            url: api('/ship'),
            body: {},
            busy: 'Booking…',
            confirm: {
              title: 'Ship this order with Shiprocket?',
              message:
                'The parcel is booked with a courier and the order is marked as shipped. The customer is emailed the tracking number.',
              confirmLabel: 'Book and ship',
              tone: 'primary',
            },
          });
        } else if (form.matches('[data-rto-form]')) {
          event.preventDefault();
          const stage =
            event.submitter && event.submitter.value === 'received'
              ? 'received'
              : 'initiated';
          const values = Nx.formValues(form);
          send(form, {
            url: api('/rto'),
            body: {stage, reason: values.reason},
            busy: 'Saving…',
            confirm:
              stage === 'received'
                ? {
                    title: 'Parcel back with you?',
                    message:
                      "Every item still on its way is cancelled, stock goes back on the shelf, and the eligible paid amount is credited to the customer’s Nexthlon wallet. This can't be undone.",
                    confirmLabel: 'Mark as back',
                    tone: 'danger',
                  }
                : {
                    title: 'Parcel coming back?',
                    message:
                      'The customer is emailed that the parcel could not be delivered.',
                    confirmLabel: 'Mark as coming back',
                    tone: 'primary',
                  },
          });
        } else if (form.matches('[data-note-form]')) {
          event.preventDefault();
          send(form, {url: api('/notes'), busy: 'Saving…'});
        } else if (form.matches('[data-return-form]')) {
          event.preventDefault();
          if (
            !event.submitter ||
            !['approve', 'reject'].includes(event.submitter.value)
          ) {
            Nx.toast('Choose Approve or Reject to continue.', 'info');
            return;
          }
          const decision =
            event.submitter && event.submitter.value === 'reject'
              ? 'reject'
              : 'approve';
          const values = Nx.formValues(form);
          if (decision === 'reject' && values.note.trim().length < 5) {
            Nx.toast(
              'Tell the customer why the return is rejected (at least 5 characters).',
              'error',
            );
            form.elements.note.focus();
            return;
          }
          send(form, {
            url: `/api/admin/returns/${id}/decision`,
            body: {
              decision,
              note: values.note,
              refundMethod: 'wallet',
            },
            busy: decision === 'approve' ? 'Approving…' : 'Rejecting…',
            confirm:
              decision === 'approve'
                ? {
                    title: 'Approve this return?',
                    message:
                      'The items count as returned, their stock goes back on the shelf, and their paid value is credited to the customer’s Nexthlon wallet.',
                    confirmLabel: 'Approve and credit wallet',
                    tone: 'primary',
                  }
                : {
                    title: 'Reject this return?',
                    message:
                      'The items stay delivered. The customer sees your note.',
                    confirmLabel: 'Reject return',
                  },
          });
        }
      },
      {signal},
    );

    // Opened with #return: show the return panel.
    if (location.hash === '#return') {
      const panel = root.querySelector('#return');
      if (panel) panel.scrollIntoView();
    }
  });

  // ---------- Lists ----------
  // Returns, transactions and reconciliation need nothing beyond the shared table behaviour (admin.js).

  // ---------- Batch print: the chosen orders, one page each ----------
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-print-selected]');
    if (!button) return;
    const ids = [...document.querySelectorAll('[data-select]:checked')].map(
      (box) => box.dataset.select,
    );
    if (!ids.length) {
      Nx.toast('Tick the orders to print first.', 'error');
      return;
    }
    const base = document.body.dataset.adminPath || '/admin';
    window.location.assign(
      `${base}/orders/print?ids=${encodeURIComponent(ids.join(','))}`,
    );
  });
})();
