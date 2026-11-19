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
})();
