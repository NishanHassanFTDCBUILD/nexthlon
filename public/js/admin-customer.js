// Customer 360: the private note, and the account actions (block, Cash on Delivery, sign out everywhere).
(function () {
  'use strict';

  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-customer-do]');
    if (!button) return;
    const box = button.closest('[data-customer-actions]');
    const id = encodeURIComponent(box.dataset.customerActions);
    const kind = button.dataset.customerDo;
    let plan;
    if (kind === 'block') {
      const blocking = button.dataset.blocked !== 'true';
      plan = {
        title: blocking ? 'Block this account?' : 'Unblock this account?',
        message: blocking
          ? 'They are signed out at once and cannot sign in until you unblock them.'
          : 'They can sign in again.',
        label: blocking ? 'Block account' : 'Unblock account',
        tone: blocking ? 'danger' : 'primary',
        url: `/api/admin/customers/${id}/block`,
        method: 'PATCH',
        body: {isBlocked: blocking},
      };
    } else if (kind === 'cod') {
      const blocking = button.dataset.codBlocked !== 'true';
      plan = {
        title: blocking
          ? 'Turn off Cash on Delivery for this account?'
          : 'Allow Cash on Delivery again?',
        message: blocking
          ? 'They can still pay online. Their orders on delivery are refused at checkout.'
          : 'Cash on Delivery is available to them again, within the usual limits.',
        label: blocking
          ? 'Turn off Cash on Delivery'
          : 'Allow Cash on Delivery',
        tone: blocking ? 'danger' : 'primary',
        url: `/api/admin/customers/${id}/cod-block`,
        method: 'PATCH',
        body: {codBlocked: blocking},
      };
    } else if (kind === 'signout') {
      plan = {
        title: 'Sign this customer out everywhere?',
        message:
          'Every phone and browser they use is signed out. They can sign in again.',
        label: 'Sign out everywhere',
        tone: 'danger',
        url: `/api/admin/customers/${id}/sign-out-all`,
        method: 'POST',
      };
    } else {
      return;
    }
    const ok = await Nx.confirm({
      title: plan.title,
      message: plan.message,
      confirmLabel: plan.label,
      tone: plan.tone,
    });
    if (!ok) return;
    Nx.busy(button, true, 'Saving…');
    try {
      const reply = await Nx.api(plan.url, {
        method: plan.method,
        body: plan.body,
      });
      Nx.flash(reply.message);
      window.location.reload();
    } catch (error) {
      Nx.busy(button, false);
      Nx.toast(error.message, 'error');
    }
  });

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
