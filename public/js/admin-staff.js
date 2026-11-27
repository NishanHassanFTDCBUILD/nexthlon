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
          const template = root.querySelector('[data-staff-row]');
          if (
            template &&
            !root.querySelector(`[data-staff-row="${reply.staff.id}"]`)
          ) {
            const row = template.cloneNode(true);
            const member = reply.staff;
            row.dataset.staffRow = member.id;
            row.classList.toggle('is-unlisted', !member.active);
            row.querySelector('.person strong').textContent = member.name;
            row.querySelector('.person div > span').textContent = member.email;
            row.querySelector('.avatar').textContent = member.name
              .charAt(0)
              .toUpperCase();
            const select = row.querySelector('[data-staff-role]');
            select.dataset.staffRole = member.id;
            select.dataset.name = member.name;
            select.dataset.before = member.role;
            select.value = member.role;
            select.setAttribute('aria-label', `Role of ${member.name}`);
            row.querySelector('[data-label="Last sign-in"]').textContent =
              'Never';
            const state = row.querySelector('[data-staff-state]');
            state.textContent = member.active ? 'Active' : 'Signed out';
            state.className = `pill ${member.active ? 'pill-green' : 'pill-red'}`;
            const toggle = row.querySelector('[data-staff-toggle]');
            toggle.dataset.staffToggle = member.id;
            toggle.dataset.active = String(member.active);
            toggle.dataset.name = member.name;
            toggle.textContent = member.active ? 'Turn off' : 'Turn on';
            toggle.className = `btn btn-sm ${member.active ? 'btn-danger-soft' : 'btn-secondary'}`;
            toggle.setAttribute(
              'aria-label',
              `${member.active ? 'Turn off access for' : 'Turn on access for'} ${member.name}`,
            );
            template.parentElement.prepend(row);
            const rows = [...root.querySelectorAll('[data-staff-row]')];
            const active = rows.filter(
              (item) =>
                item.querySelector('[data-staff-toggle]').dataset.active ===
                'true',
            ).length;
            root.querySelector('.admin-top .muted').textContent =
              `${rows.length} ${rows.length === 1 ? 'account' : 'accounts'}, ${active} active. Each role sees only the parts of the console it needs.`;
          }
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

    const pending = new WeakSet();
    async function refresh(message) {
      if (window.NxNav) {
        await window.NxNav.reload();
        Nx.toast(message);
      } else {
        Nx.flash(message);
        window.location.reload();
      }
    }
    root.addEventListener(
      'change',
      async (event) => {
        const select = event.target.closest('[data-staff-role]');
        if (!select || pending.has(select)) return;
        const before = select.dataset.before;
        const next = select.value;
        pending.add(select);
        select.disabled = true;
        try {
          const ok = await Nx.confirm({
            title: 'Change ' + select.dataset.name + "'s role?",
            message:
              'Their access changes straight away: the console shows only what the new role allows.',
            confirmLabel: 'Change the role',
            tone: 'primary',
          });
          if (!ok || signal.aborted) {
            select.value = before;
            return;
          }
          const reply = await Nx.api(
            '/api/admin/staff/' +
              encodeURIComponent(select.dataset.staffRole) +
              '/role',
            {method: 'PATCH', body: {role: next}},
          );
          select.dataset.before = reply.staff.role;
          select.value = reply.staff.role;
          Nx.toast(reply.message);
        } catch (error) {
          select.value = before;
          Nx.toast(error.message, 'error');
        } finally {
          select.disabled = false;
          pending.delete(select);
        }
      },
      {signal},
    );
    root.addEventListener(
      'click',
      async (event) => {
        const button = event.target.closest('[data-staff-toggle]');
        if (!button || pending.has(button)) return;
        const active = button.dataset.active === 'true';
        const name = button.dataset.name;
        pending.add(button);
        try {
          const ok = await Nx.confirm({
            title: (active ? 'Turn off ' : 'Turn on ') + name + "'s access?",
            message: active
              ? 'They are signed out everywhere and cannot sign in until you turn them back on.'
              : 'They can sign in again with their existing password.',
            confirmLabel: active ? 'Turn off access' : 'Turn on access',
            tone: active ? 'danger' : 'primary',
          });
          if (!ok || signal.aborted) return;
          Nx.busy(button, true, active ? 'Turning off.' : 'Turning on.');
          const reply = await Nx.api(
            '/api/admin/staff/' +
              encodeURIComponent(button.dataset.staffToggle) +
              '/active',
            {method: 'PATCH', body: {active: !active}},
          );
          await refresh(reply.message);
        } catch (error) {
          Nx.toast(error.message, 'error');
        } finally {
          pending.delete(button);
          Nx.busy(button, false);
        }
      },
      {signal},
    );
  });
})();
