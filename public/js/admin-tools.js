// Console tools for every admin page: keyboard shortcuts with a help sheet, a density switch
// (comfortable or compact rows, remembered in this browser), and saved list views (kept on the server,
// per admin: see controllers/adminViewController.js).
(function () {
  'use strict';

  const base = () => document.body.dataset.adminPath || '/admin';
  const isTyping = (el) =>
    !!el &&
    (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  const go = (href) =>
    window.NxNav && window.NxNav.inArea && window.NxNav.inArea(href)
      ? window.NxNav.go(href)
      : window.location.assign(href);

  // ---------- Density ----------
  const DENSITY_KEY = 'nx-admin-density';
  function readDensity() {
    try {
      return localStorage.getItem(DENSITY_KEY) === 'compact'
        ? 'compact'
        : 'comfortable';
    } catch {
      return 'comfortable';
    }
  }
  function applyDensity(value) {
    document.body.dataset.density = value;
    try {
      localStorage.setItem(DENSITY_KEY, value);
    } catch {
      /* private browsing: the choice lasts for this visit only */
    }
    document.querySelectorAll('[data-density-toggle]').forEach((b) => {
      b.setAttribute('aria-pressed', String(value === 'compact'));
      b.textContent = value === 'compact' ? 'Comfortable rows' : 'Compact rows';
    });
  }
  function toggleDensity() {
    applyDensity(
      document.body.dataset.density === 'compact' ? 'comfortable' : 'compact',
    );
  }
  applyDensity(readDensity());

  // ---------- Keyboard shortcuts ----------
  const GO = {
    o: 'orders',
    p: 'products',
    c: 'customers',
    i: 'inventory',
    s: 'settings',
    r: 'reviews',
    d: 'deals',
    t: 'support',
  };
  let pendingG = 0;

  function openHelp() {
    const dialog = document.getElementById('admin-help');
    if (dialog && !dialog.open) dialog.showModal();
  }

  document.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target;
    if (isTyping(target)) return;
    const dialogOpen = document.querySelector('dialog[open]');
    if (dialogOpen) return;

    if (pendingG && Date.now() - pendingG < 1200) {
      const section = GO[event.key.toLowerCase()];
      pendingG = 0;
      if (section) {
        event.preventDefault();
        go(`${base()}/${section}`);
        return;
      }
    }
    pendingG = 0;

    if (event.key === '/') {
      const search =
        document.querySelector('.admin-content input[type="search"]') ||
        document.querySelector('[data-admin-search-input]');
      if (search) {
        event.preventDefault();
        search.focus();
      }
    } else if (event.key === 'g') {
      pendingG = Date.now();
    } else if (event.key === '?') {
      event.preventDefault();
      openHelp();
    } else if (event.key === 'd') {
      toggleDensity();
    }
  });

  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-density-toggle]')) toggleDensity();
    if (event.target.closest('[data-open-help]')) openHelp();
    const close = event.target.closest('[data-close-help]');
    if (close) {
      const dialog = document.getElementById('admin-help');
      if (dialog && dialog.open) dialog.close();
    }
  });

  // ---------- Saved views ----------
  // A bar above every list page: the views kept for this list, and "Save this view" for the current filters.
  function listPath() {
    return window.location.pathname.replace(/\/$/, '');
  }

  function onListPage() {
    return !!document.querySelector(
      '.admin-content .admin-filterbar, .admin-content .admin-table-panel',
    );
  }

  async function renderViews() {
    const content = document.querySelector('.admin-content');
    if (!content) return;
    const existing = content.querySelector('[data-saved-views]');
    if (!onListPage()) {
      if (existing) existing.remove();
      return;
    }
    if (existing && existing.dataset.path === listPath()) return;
    if (existing) existing.remove();

    const bar = document.createElement('section');
    bar.className = 'saved-views';
    bar.dataset.savedViews = '';
    bar.dataset.path = listPath();
    bar.setAttribute('aria-label', 'Saved views');
    bar.innerHTML =
      '<span class="saved-views-label">Saved views</span>' +
      '<ul class="saved-views-list"></ul>' +
      '<form class="saved-views-save" novalidate>' +
      '<label class="sr-only" for="view-name">Name this view</label>' +
      '<input id="view-name" name="name" maxlength="40" placeholder="Name this view" autocomplete="off">' +
      '<button class="btn btn-ghost btn-sm" type="submit">Save this view</button>' +
      '</form>';
    content.prepend(bar);

    const list = bar.querySelector('.saved-views-list');
    try {
      const reply = await window.Nx.api(
        `/api/admin/views?path=${encodeURIComponent(listPath())}`,
      );
      if (!reply.views.length) {
        list.innerHTML =
          '<li class="muted">None yet. Filter the list, then name and save it.</li>';
      }
      reply.views.forEach((view) => {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.className = 'saved-view';
        a.href = `${listPath()}?${view.query}`;
        a.textContent = view.name;
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'saved-view-remove';
        del.dataset.viewRemove = view.id;
        del.setAttribute('aria-label', `Remove the view ${view.name}`);
        del.textContent = '×';
        li.append(a, del);
        list.append(li);
      });
    } catch {
      list.innerHTML =
        '<li class="muted">Saved views could not load. Try again later.</li>';
    }
  }

  document.addEventListener('submit', async (event) => {
    const form = event.target.closest('.saved-views-save');
    if (!form) return;
    event.preventDefault();
    const name = form.elements.name.value.trim();
    try {
      const reply = await window.Nx.api('/api/admin/views', {
        method: 'POST',
        body: {
          path: listPath(),
          name,
          query: window.location.search.replace(/^\?/, ''),
        },
      });
      window.Nx.toast(reply.message);
      form.reset();
      document.querySelector('[data-saved-views]').dataset.path = '';
      renderViews();
    } catch (error) {
      window.Nx.toast(error.message, 'error');
    }
  });

  document.addEventListener('click', async (event) => {
    const remove = event.target.closest('[data-view-remove]');
    if (!remove) return;
    event.preventDefault();
    try {
      await window.Nx.api(
        `/api/admin/views/${encodeURIComponent(remove.dataset.viewRemove)}`,
        {method: 'DELETE'},
      );
      remove.closest('li').remove();
    } catch (error) {
      window.Nx.toast(error.message, 'error');
    }
  });

  // Sections load without a reload, so look again whenever the content changes.
  const observer = new MutationObserver(() => renderViews());
  const content = document.querySelector('.admin-content');
  if (content) observer.observe(content, {childList: true});
  window.addEventListener('popstate', () => renderViews());
  renderViews();

  // ---------- Side drawer: quick look at an order ----------
  const drawer = document.getElementById('admin-drawer');
  const backdrop = document.querySelector(
    '[data-drawer-close].drawer-backdrop',
  );
  let returnFocus = null;
  const esc = (text) =>
    String(text == null ? '' : text).replace(
      /[&<>"']/g,
      (ch) =>
        ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[
          ch
        ],
    );
  const money = (paise) =>
    `₹${(Number(paise || 0) / 100).toLocaleString('en-IN', {maximumFractionDigits: 2})}`;

  function closeDrawer() {
    if (!drawer || drawer.hidden) return;
    drawer.hidden = true;
    if (backdrop) backdrop.hidden = true;
    if (returnFocus) returnFocus.focus();
  }

  async function openQuickLook(orderId, trigger) {
    if (!drawer) return;
    returnFocus = trigger;
    drawer.hidden = false;
    if (backdrop) backdrop.hidden = false;
    const body = drawer.querySelector('[data-drawer-body]');
    body.textContent = 'Loading…';
    drawer.querySelector('[data-drawer-open-page]').href =
      `${base()}/orders/${encodeURIComponent(orderId)}`;
    drawer.focus();
    try {
      const data = await window.Nx.api(
        `/api/admin/orders/${encodeURIComponent(orderId)}`,
      );
      const o = data.order;
      const items = (o.items || [])
        .map(
          (i) =>
            `<li><strong>${esc(i.name)}</strong>${i.option ? ` · ${esc(i.option)}` : ''} × ${i.quantity} <span class="muted">${money(i.lineTotal)}</span></li>`,
        )
        .join('');
      const tags = (o.tags || [])
        .map((t) => `<span class="pill pill-grey">${esc(t)}</span>`)
        .join(' ');
      const risk =
        data.risk && data.risk.applies
          ? `<p>Cash on delivery risk: <strong>${esc(data.risk.level)}</strong></p>`
          : '';
      body.innerHTML =
        `<h3>${esc(o.orderId)}</h3>` +
        `<p><span class="pill pill-grey">${esc(String(o.orderStatus).replace(/_/g, ' '))}</span> ${esc(o.paymentMethod === 'cod' ? 'Cash on delivery' : 'Paid online')}</p>` +
        `<p class="muted">${esc(o.address && o.address.fullName)} · ${esc(o.address && o.address.city)}, ${esc(o.address && o.address.state)}</p>` +
        `<ul class="drawer-items">${items}</ul>` +
        `<p><strong>Total ${money(o.total)}</strong></p>` +
        risk +
        (tags ? `<p>${tags}</p>` : '');
    } catch (error) {
      body.textContent = error.message;
    }
  }

  document.addEventListener('click', (event) => {
    const look = event.target.closest('[data-quick-look]');
    if (look) {
      event.preventDefault();
      openQuickLook(look.dataset.quickLook, look);
      return;
    }
    if (event.target.closest('[data-drawer-close]')) closeDrawer();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && drawer && !drawer.hidden) closeDrawer();
  });

  // ---------- Phone: the filters open as a sheet ----------
  const phone = window.matchMedia('(max-width: 720px)');
  function addFilterSheets() {
    document
      .querySelectorAll('.admin-content .admin-filterbar')
      .forEach((bar) => {
        if (
          bar.previousElementSibling &&
          bar.previousElementSibling.classList.contains('filter-sheet-toggle')
        )
          return;
        if (!phone.matches) return;
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'btn btn-secondary btn-sm filter-sheet-toggle';
        toggle.setAttribute('aria-expanded', 'false');
        toggle.textContent = 'Filters';
        toggle.addEventListener('click', () => {
          const open = !bar.classList.contains('is-sheet');
          bar.classList.toggle('is-sheet', open);
          toggle.setAttribute('aria-expanded', String(open));
          if (open) bar.querySelector('input, select')?.focus();
        });
        bar.classList.add('has-sheet');
        bar.before(toggle);
      });
  }
  phone.addEventListener?.('change', addFilterSheets);

  // ---------- Inline edit with undo ----------
  // A value shown with an Edit button: change it in place, save, and a short "Undo" restores the old one.
  document.addEventListener('click', async (event) => {
    const edit = event.target.closest('[data-inline-edit]');
    if (edit) {
      event.preventDefault();
      const cell = edit.closest('[data-inline-cell]');
      const input = document.createElement('input');
      input.type = 'number';
      input.inputMode = 'numeric';
      input.min = edit.dataset.min || '0';
      input.max = edit.dataset.max || '100';
      input.step = '1';
      input.value = edit.dataset.value;
      input.setAttribute('aria-label', edit.dataset.label);
      const save = document.createElement('button');
      save.type = 'button';
      save.className = 'btn btn-primary btn-sm';
      save.textContent = 'Save';
      save.dataset.inlineSave = '';
      cell.replaceChildren(input, save);
      input.focus();
      input.dataset.endpoint = edit.dataset.endpoint;
      input.dataset.field = edit.dataset.field;
      input.dataset.label = edit.dataset.label;
      input.dataset.unit = edit.dataset.unit || '';
      return;
    }
    const saveBtn = event.target.closest('[data-inline-save]');
    if (saveBtn) {
      const input = saveBtn.parentElement.querySelector('input');
      const cell = saveBtn.closest('[data-inline-cell]');
      const next = Number(input.value);
      const previous = cell.dataset.current;
      if (
        !Number.isInteger(next) ||
        next < Number(input.min) ||
        next > Number(input.max)
      ) {
        window.Nx.toast(
          `Enter a whole number from ${input.min} to ${input.max}.`,
          'error',
        );
        input.focus();
        return;
      }
      try {
        const reply = await window.Nx.api(input.dataset.endpoint, {
          method: 'PATCH',
          body: {[input.dataset.field]: next},
        });
        renderInline(cell, next, input.dataset);
        const status = document.createElement('span');
        status.className = 'inline-undo';
        status.setAttribute('role', 'status');
        status.innerHTML = `${esc(reply.message || 'Saved.')} <button type="button" class="link-btn" data-inline-undo>Undo</button>`;
        status.dataset.endpoint = input.dataset.endpoint;
        status.dataset.field = input.dataset.field;
        status.dataset.previous = previous;
        status.dataset.unit = input.dataset.unit;
        status.dataset.label = input.dataset.label;
        cell.after(status);
        setTimeout(() => status.remove(), 8000);
      } catch (error) {
        window.Nx.toast(error.message, 'error');
      }
      return;
    }
    const undo = event.target.closest('[data-inline-undo]');
    if (undo) {
      const status = undo.closest('.inline-undo');
      const cell = status.previousElementSibling;
      try {
        await window.Nx.api(status.dataset.endpoint, {
          method: 'PATCH',
          body: {[status.dataset.field]: Number(status.dataset.previous)},
        });
        renderInline(
          cell,
          Number(status.dataset.previous),
          status.dataset,
          status.dataset.previous,
        );
        status.remove();
        window.Nx.toast('Change undone.');
      } catch (error) {
        window.Nx.toast(error.message, 'error');
      }
    }
  });

  function renderInline(cell, value, data) {
    cell.dataset.current = String(value);
    cell.replaceChildren();
    const text = document.createElement('span');
    text.textContent = `${value}${data.unit || ''}`;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'link-btn';
    button.dataset.inlineEdit = '';
    button.dataset.endpoint = data.endpoint;
    button.dataset.field = data.field;
    button.dataset.label = data.label;
    button.dataset.unit = data.unit || '';
    button.dataset.value = String(value);
    button.dataset.min = '0';
    button.dataset.max = '90';
    button.textContent = 'Edit';
    button.setAttribute('aria-label', `Edit ${data.label}`);
    cell.append(text, ' ', button);
  }
  addFilterSheets();
})();
