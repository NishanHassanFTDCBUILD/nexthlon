// Admin Staff: add an account (the temporary password is shown once), change a role, and turn an
// account's access on or off. The server checks every change again (services/staffService.js).
(function () {
  'use strict';

  const Pages = window.NxPages;
  if (!Pages || !Pages.define) return;

  Pages.define('admin-staff', (root, signal) => {
    const form = root.querySelector('[data-staff-form]');
    const roleSelect = root.querySelector('#staff-role');
    const help = root.querySelector('[data-role-help]');
    const once = root.querySelector('[data-staff-once]');
    const helpByRole = {};
    root.querySelectorAll('.staff-role').forEach((card) => {
      const key = card.dataset.roleKey;
      if (key) helpByRole[key] = card.querySelector('p').textContent;
    });

    // The help under the role picker follows the role chosen.
    if (roleSelect && help) {
      roleSelect.addEventListener(
        'change',
        () => {
          help.textContent = helpByRole[roleSelect.value] || '';
        },
        {signal},
      );
    }

    // Add an account.
    if (form) {
      form.addEventListener(
        'submit',
        async (event) => {
          event.preventDefault();
          const reply = await Nx.submitForm(form, {
            url: '/api/admin/staff',
            method: 'POST',
            busyLabel: 'Creating…',
          });
          if (!reply) return;
          Nx.toast(reply.message);
          once.hidden = false;
          once.querySelector('[data-once-name]').textContent = reply.staff.name;
          once.querySelector('[data-once-password]').textContent =
            reply.temporaryPassword;
          form.reset();
          if (roleSelect) roleSelect.value = 'packing';
          if (help) help.textContent = helpByRole.packing || '';
        },
        {signal},
      );
    }

    once &&
      once.addEventListener(
        'click',
        async (event) => {
          if (!event.target.closest('[data-once-copy]')) return;
          const text = once.querySelector('[data-once-password]').textContent;
          try {
            await navigator.clipboard.writeText(text);
            Nx.toast('Password copied.');
          } catch {
            Nx.toast('Select the password and copy it by hand.', 'error');
          }
        },
        {signal},
      );

    // Change a role straight from the table. Undo by choosing the old role again.
    root.addEventListener(
      'change',
      async (event) => {
        const select = event.target.closest('[data-staff-role]');
        if (!select) return;
        const id = select.dataset.staffRole;
        const before = select.dataset.before;
        const next = select.value;
        const ok = await Nx.confirm({
          title: `Change ${select.dataset.name}'s role?`,
          message:
            'Their access changes straight away: the console shows only what the new role allows.',
          confirmLabel: 'Change the role',
          tone: 'primary',
        });
        if (!ok) {
          select.value = before;
          return;
        }
        try {
          const reply = await Nx.api(
            `/api/admin/staff/${encodeURIComponent(id)}/role`,
            {method: 'PATCH', body: {role: next}},
          );
          select.dataset.before = reply.staff.role;
          Nx.toast(reply.message);
        } catch (error) {
          select.value = before;
          Nx.toast(error.message, 'error');
        }
      },
      {signal},
    );

    root.addEventListener(
      'click',
      async (event) => {
        const button = event.target.closest('[data-staff-toggle]');
        if (!button) return;
        const id = button.dataset.staffToggle;
        const active = button.dataset.active === 'true';
        const name = button.dataset.name;
        const ok = await Nx.confirm({
          title: active
            ? `Turn off ${name}'s access?`
            : `Turn on ${name}'s access?`,
          message: active
            ? 'They are signed out everywhere and cannot sign in until you turn them back on.'
            : 'They can sign in again with their existing password.',
          confirmLabel: active ? 'Turn off access' : 'Turn on access',
          tone: active ? 'danger' : 'primary',
        });
        if (!ok) return;
        Nx.busy(button, true, active ? 'Turning off…' : 'Turning on…');
        try {
          const reply = await Nx.api(
            `/api/admin/staff/${encodeURIComponent(id)}/active`,
            {method: 'PATCH', body: {active: !active}},
          );
          // The page reloads the list so every row shows its real state.
          Nx.flash(reply.message);
          window.location.reload();
        } catch (error) {
          Nx.busy(button, false);
          Nx.toast(error.message, 'error');
        }
      },
      {signal},
    );
  });
})();
