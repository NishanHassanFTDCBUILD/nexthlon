// Admin console: the shell (collapsible sidebar groups, the phone menu, global search, the Ctrl+K
// command palette and the notification bell), plus the small sections that need no file of their
// own (customers, settings, system status). No animation: everything appears and disappears
// instantly. The bigger sections live in their own files: admin-dashboard.js (dashboard and
// analytics), admin-products.js, admin-orders.js, admin-catalog.js (inventory)
// and admin-coupons.js.
// Section modules use window.NxPages (section-nav.js) with init(root)/destroy(), so they keep
// working when sections switch without a reload.
(function () {
  'use strict';

  const body = document.body;
  const BASE = body.dataset.adminPath || '';
  if (!BASE || !document.querySelector('.admin-shell')) return;
  const Pages = window.NxPages;
  const go = (href) =>
    window.NxNav && window.NxNav.inArea(href)
      ? window.NxNav.go(href)
      : window.location.assign(href);
  const store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem(key);
        return v === null ? fallback : JSON.parse(v);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        /* storage blocked */
      }
    },
  };
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const iconSvg = (name) =>
    `<svg class="i i-sm" aria-hidden="true"><use href="/img/icons.svg#${name}"></use></svg>`;

  // ---------- Sidebar: collapsible groups (remembered), the group with the active page stays open ----------
  const COLLAPSED_KEY = 'nx-admin-collapsed';
  function setGroup(group, open) {
    const toggle = group.querySelector('[data-admin-group-toggle]');
    toggle.setAttribute('aria-expanded', String(open));
    group.querySelector('.admin-group-items').hidden = !open;
  }
  function applyGroups() {
    const collapsed = store.get(COLLAPSED_KEY, []);
    document.querySelectorAll('[data-admin-group]').forEach((group) => {
      const hasActive = Boolean(group.querySelector('.admin-link.is-active'));
      setGroup(
        group,
        hasActive || !collapsed.includes(group.dataset.adminGroup),
      );
    });
  }
  document.addEventListener('click', (event) => {
    const toggle =
      event.target instanceof Element &&
      event.target.closest('[data-admin-group-toggle]');
    if (!toggle) return;
    const group = toggle.closest('[data-admin-group]');
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    setGroup(group, open);
    const collapsed = new Set(store.get(COLLAPSED_KEY, []));
    if (open) collapsed.delete(group.dataset.adminGroup);
    else collapsed.add(group.dataset.adminGroup);
    store.set(COLLAPSED_KEY, [...collapsed]);
  });
  applyGroups();

  // ---------- Desktop: the sidebar folds to icons (remembered in this browser) ----------
  const SIDE_FOLDED_KEY = 'nx-admin-side-folded';
  const foldButton = document.querySelector('[data-admin-side-fold]');
  function setFolded(folded) {
    body.classList.toggle('admin-side-folded', folded);
    if (foldButton) {
      foldButton.setAttribute('aria-expanded', String(!folded));
      foldButton.setAttribute(
        'aria-label',
        folded ? 'Expand sidebar' : 'Fold sidebar to icons',
      );
    }
  }
  setFolded(store.get(SIDE_FOLDED_KEY, false) === true);
  if (foldButton)
    foldButton.addEventListener('click', () => {
      const folded = !body.classList.contains('admin-side-folded');
      setFolded(folded);
      store.set(SIDE_FOLDED_KEY, folded);
    });

  // ---------- Phones and tablets: the sidebar is a menu panel ----------
  const side = document.querySelector('[data-admin-side]');
  const scrim = document.querySelector('.admin-scrim');
  const menuButton = document.querySelector(
    '.admin-menu-btn[data-admin-menu-open]',
  );
  const moreButtons = document.querySelectorAll('[data-admin-menu-open]');
  function setMenu(open) {
    side.classList.toggle('is-open', open);
    scrim.hidden = !open;
    if (menuButton) menuButton.setAttribute('aria-expanded', String(open));
    body.classList.toggle('admin-menu-open', open);
    if (open)
      (
        side.querySelector('.admin-link.is-active') || side.querySelector('a')
      ).focus();
    else if (side.contains(document.activeElement) && menuButton)
      menuButton.focus();
  }
  moreButtons.forEach((button) =>
    button.addEventListener('click', () => setMenu(true)),
  );
  document
    .querySelectorAll('[data-admin-menu-close]')
    .forEach((button) =>
      button.addEventListener('click', () => setMenu(false)),
    );
  side.addEventListener('click', (event) => {
    if (event.target.closest('a[href]')) setMenu(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && side.classList.contains('is-open'))
      setMenu(false);
  });

  // A new section is shown: keep its sidebar group open.
  document.addEventListener('nx:section', applyGroups);

  // ---------- Search (top bar and palette share it) ----------
  const STATUS = {
    placed: 'Placed',
    confirmed: 'Confirmed',
    shipped: 'Shipped',
    out_for_delivery: 'Out for delivery',
    delivered: 'Delivered',
    cancelled: 'Cancelled',
    return_requested: 'Return requested',
    returned: 'Returned',
  };
  const cache = new Map();
  async function searchApi(q) {
    const key = q.toLowerCase();
    if (cache.has(key)) return cache.get(key);
    const reply = await Nx.api(`/api/admin/search?q=${encodeURIComponent(q)}`);
    cache.set(key, reply.results);
    if (cache.size > 30) cache.delete(cache.keys().next().value);
    return reply.results;
  }
  // Results as plain entries: { group, label, meta, href, icon }.
  function entriesFrom(results) {
    return [
      ...results.orders.map((o) => ({
        group: 'Orders',
        icon: 'package-check',
        label: o.orderId,
        meta: `${o.customer} · ${Nx.formatPrice(o.total)} · ${STATUS[o.status] || o.status}`,
        href: `${BASE}/orders?q=${encodeURIComponent(o.orderId)}`,
      })),
      ...results.products.map((p) => ({
        group: 'Products',
        icon: 'box',
        label: p.name,
        meta: `${p.brand ? p.brand + ' · ' : ''}${p.stock} in stock${p.isListed ? '' : ' · unlisted'}`,
        href: `${BASE}/products/${p.id}/edit`,
      })),
      ...results.customers.map((c) => ({
        group: 'Customers',
        icon: 'users',
        label: c.name,
        meta: `${c.email}${c.isBlocked ? ' · blocked' : ''}`,
        href: `${BASE}/customers?q=${encodeURIComponent(c.email)}`,
      })),
    ];
  }

  // A keyboard-friendly list (top bar dropdown and palette): arrows, Enter, mouse.
  function makeList(listEl, input, onPick) {
    let entries = [];
    let index = -1;
    function render(items, emptyText) {
      entries = items;
      index = items.length ? 0 : -1;
      listEl.textContent = '';
      if (!items.length) {
        listEl.append(el('li', 'admin-list-empty', emptyText || 'No matches.'));
        input.removeAttribute('aria-activedescendant');
        return;
      }
      let lastGroup = '';
      items.forEach((entry, i) => {
        if (entry.group !== lastGroup) {
          lastGroup = entry.group;
          const head = el('li', 'admin-list-group', entry.group);
          head.setAttribute('role', 'presentation');
          listEl.append(head);
        }
        const li = el('li', 'admin-list-item');
        li.id = `${listEl.id}-${i}`;
        li.setAttribute('role', 'option');
        li.dataset.index = String(i);
        li.innerHTML = iconSvg(entry.icon);
        const text = el('span', 'admin-list-text');
        text.append(el('strong', '', entry.label));
        if (entry.meta) text.append(el('small', '', entry.meta));
        li.append(text);
        listEl.append(li);
      });
      highlight();
    }
    function highlight() {
      listEl.querySelectorAll('.admin-list-item').forEach((li) => {
        const on = Number(li.dataset.index) === index;
        li.classList.toggle('is-active', on);
        li.setAttribute('aria-selected', String(on));
        if (on) {
          input.setAttribute('aria-activedescendant', li.id);
          li.scrollIntoView({block: 'nearest'});
        }
      });
    }
    input.addEventListener('keydown', (event) => {
      if (!entries.length) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        index =
          (index + (event.key === 'ArrowDown' ? 1 : -1) + entries.length) %
          entries.length;
        highlight();
      } else if (event.key === 'Enter' && index >= 0) {
        event.preventDefault();
        onPick(entries[index]);
      }
    });
    listEl.addEventListener('mousedown', (event) => event.preventDefault()); // keep focus in the input
    listEl.addEventListener('click', (event) => {
      const li = event.target.closest('.admin-list-item');
      if (li) onPick(entries[Number(li.dataset.index)]);
    });
    return {
      render,
      clear() {
        entries = [];
        index = -1;
        listEl.textContent = '';
      },
    };
  }

  function debounce(fn, ms) {
    let timer = 0;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  }

  // ---------- Top bar search ----------
  const searchBox = document.querySelector('[data-admin-search]');
  const searchInput = searchBox.querySelector('[data-admin-search-input]');
  const searchPop = searchBox.querySelector('[data-admin-search-results]');
  let searchSeq = 0;
  function closeSearch() {
    searchPop.hidden = true;
    searchInput.setAttribute('aria-expanded', 'false');
  }
  const searchList = makeList(searchPop, searchInput, (entry) => {
    closeSearch();
    searchInput.value = '';
    go(entry.href);
  });
  const runSearch = debounce(async () => {
    const q = searchInput.value.trim();
    const seq = ++searchSeq;
    if (q.length < 2) return closeSearch();
    try {
      const results = await searchApi(q);
      if (seq !== searchSeq) return;
      searchList.render(entriesFrom(results), `Nothing found for "${q}".`);
      searchPop.hidden = false;
      searchInput.setAttribute('aria-expanded', 'true');
    } catch (error) {
      if (seq === searchSeq) Nx.toast(error.message, 'error');
    }
  }, 180);
  searchInput.addEventListener('input', runSearch);
  searchInput.addEventListener('focus', () => {
    if (searchInput.value.trim().length >= 2) runSearch();
  });
  searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeSearch();
      searchInput.blur();
    }
  });
  document.addEventListener('click', (event) => {
    if (!searchBox.contains(event.target)) closeSearch();
  });

  // ---------- Ctrl+K command palette ----------
  const palette = document.querySelector('[data-admin-palette]');
  const paletteInput = palette.querySelector('[data-admin-palette-input]');
  const paletteList = palette.querySelector('[data-admin-palette-list]');
  const sections = [
    ...document.querySelectorAll('.admin-link[data-nav-link]'),
  ].map((link) => ({
    group: 'Go to',
    icon:
      (link.querySelector('use') || {getAttribute: () => ''})
        .getAttribute('href')
        .split('#')[1] || 'grid',
    label: link.dataset.label,
    meta: link.dataset.group,
    href: link.getAttribute('href'),
  }));
  let paletteSeq = 0;
  const list = makeList(paletteList, paletteInput, (entry) => {
    palette.close();
    go(entry.href);
  });
  const updatePalette = debounce(async () => {
    const q = paletteInput.value.trim().toLowerCase();
    const seq = ++paletteSeq;
    const matches = sections.filter(
      (s) =>
        !q ||
        s.label.toLowerCase().includes(q) ||
        s.meta.toLowerCase().includes(q),
    );
    list.render(matches, 'No sections match.');
    if (q.length < 2) return;
    try {
      const results = await searchApi(q);
      if (seq !== paletteSeq || !palette.open) return;
      list.render(
        [...matches, ...entriesFrom(results)],
        `Nothing found for "${paletteInput.value.trim()}".`,
      );
    } catch {
      /* the section list still works */
    }
  }, 150);
  function openPalette() {
    if (palette.open) return;
    closeSearch();
    paletteInput.value = '';
    palette.showModal();
    paletteInput.focus();
    updatePalette();
  }
  paletteInput.addEventListener('input', updatePalette);
  palette.addEventListener('click', (event) => {
    if (event.target === palette) palette.close();
  });
  document
    .querySelectorAll('[data-admin-palette-open]')
    .forEach((button) => button.addEventListener('click', openPalette));
  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      if (palette.open) palette.close();
      else openPalette();
    } else if (
      event.key === '/' &&
      !event.ctrlKey &&
      !event.metaKey &&
      !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) &&
      !document.activeElement.isContentEditable
    ) {
      event.preventDefault();
      searchInput.focus();
    }
  });

  // ---------- Notification bell ----------
  const bell = document.querySelector('[data-admin-bell]');
  const bellToggle = bell.querySelector('[data-admin-bell-toggle]');
  const bellPanel = bell.querySelector('[data-admin-bell-panel]');
  const bellList = bell.querySelector('[data-admin-bell-list]');
  const bellCount = bell.querySelector('[data-admin-bell-count]');
  async function loadBell() {
    try {
      const data = await Nx.api('/api/admin/notifications');
      bellCount.hidden = data.total === 0;
      bellCount.textContent = data.total > 99 ? '99+' : String(data.total);
      bellToggle.setAttribute(
        'aria-label',
        data.total
          ? `Notifications, ${data.total} need attention`
          : 'Notifications, nothing needs attention',
      );
      bellList.textContent = '';
      data.items.forEach((item) => {
        const li = el('li', item.count ? '' : 'is-zero');
        const a = el('a', 'admin-bell-item');
        a.href = `${BASE}/${item.section}`;
        a.innerHTML = iconSvg(item.icon);
        a.append(
          el('span', '', item.label),
          el('strong', '', String(item.count)),
        );
        li.append(a);
        bellList.append(li);
      });
    } catch {
      bellList.textContent = '';
      bellList.append(el('li', 'muted', 'Could not load notifications.'));
    }
  }
  function setBell(open) {
    bellPanel.hidden = !open;
    bellToggle.setAttribute('aria-expanded', String(open));
    if (open) loadBell();
  }
  bellToggle.addEventListener('click', () => setBell(bellPanel.hidden));
  bell
    .querySelector('[data-admin-bell-refresh]')
    .addEventListener('click', loadBell);
  bellPanel.addEventListener('click', (event) => {
    if (event.target.closest('a')) setBell(false);
  });
  document.addEventListener('click', (event) => {
    if (!bell.contains(event.target)) setBell(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !bellPanel.hidden) {
      setBell(false);
      bellToggle.focus();
    }
  });
  loadBell();
  // Refresh the badge every 2 minutes while the tab is visible.
  setInterval(() => {
    if (!document.hidden && bellPanel.hidden) loadBell();
  }, 120000);

  // After a change, show the section again with fresh data (the no-reload router swaps content).
  const refresh = (message) => {
    if (window.NxNav)
      return window.NxNav.reload().then(() => message && Nx.toast(message));
    if (message) Nx.flash(message);
    window.location.reload();
    return Promise.resolve();
  };

  // ================= Shared section behaviour =================

  // Every admin table: a row with data-row-href opens its record when clicked anywhere that is
  // not a control, and a select marked data-auto-submit applies its form as soon as it changes
  // (filters, sort, rows per page). Bound once on the document, so sections loaded without a
  // reload get it too.
  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0) return;
    const row = event.target.closest('.admin-content tr[data-row-href]');
    if (
      !row ||
      event.target.closest('a, button, input, select, label, textarea') ||
      String(window.getSelection && window.getSelection()).length
    )
      return;
    if (event.ctrlKey || event.metaKey) {
      window.open(row.dataset.rowHref, '_blank', 'noopener');
      return;
    }
    go(row.dataset.rowHref);
  });
  // Unsaved changes on a long form (a product, coupon, category or deal): the save bar says so,
  // and leaving the page asks first. A successful save moves on to the list, which ends it; a
  // failed save keeps the warning, because the changes are still not saved.
  let dirty = null;
  const SAVE_FORMS =
    '.admin-content form[data-product-form], .admin-content form[data-coupon-form], ' +
    '.admin-content form[data-category-form], .admin-content form[data-deal-form]';
  const setDirty = (form) => {
    dirty = form;
    const bar = form && form.querySelector('.admin-save-bar');
    if (!bar) return;
    let note = bar.querySelector('.admin-save-note');
    if (!note) {
      note = document.createElement('span');
      note.className = 'admin-save-note';
      note.setAttribute('role', 'status');
      bar.prepend(note);
    }
    bar.classList.add('is-dirty');
    note.textContent = 'Unsaved changes';
  };
  const isDirty = () => Boolean(dirty && document.contains(dirty));
  ['input', 'change'].forEach((type) =>
    document.addEventListener(type, (event) => {
      const form = event.target.closest(SAVE_FORMS);
      if (form && !event.target.closest('[data-auto-submit]')) setDirty(form);
    }),
  );
  window.addEventListener('beforeunload', (event) => {
    if (!isDirty()) return;
    event.preventDefault();
    event.returnValue = '';
  });
  // Links inside the console load without a reload (section-nav.js), so ask here first.
  document.addEventListener(
    'click',
    (event) => {
      if (!isDirty() || event.defaultPrevented) return;
      const link = event.target.closest('a[href]');
      if (!link || link.closest('form') === dirty || link.target === '_blank')
        return;
      if (window.confirm('You have unsaved changes. Leave without saving?'))
        dirty = null;
      else {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    true,
  );

  // "More filters" panels close on Esc or a click outside, and return focus to their summary.
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const open = document.querySelector('.admin-more-filters[open]');
    if (!open) return;
    open.open = false;
    open.querySelector('summary').focus();
  });
  document.addEventListener('click', (event) => {
    document.querySelectorAll('.admin-more-filters[open]').forEach((panel) => {
      if (!panel.contains(event.target)) panel.open = false;
    });
  });
  // Buttons marked data-print print the page (the print styles hide the console chrome).
  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-print]')) window.print();
  });
  document.addEventListener('change', (event) => {
    const select = event.target.closest('.admin-content [data-auto-submit]');
    if (select && select.form) select.form.requestSubmit();
  });

  // ---------- Customers: block and unblock without reloading ----------
  Pages.define('admin-customers', (root, signal) => {
    root.addEventListener(
      'click',
      async (event) => {
        const button = event.target.closest('[data-block-user]');
        if (!button) return;
        const isBlocked = button.dataset.blocked === 'true';
        const name = button.dataset.name;
        const confirmed = await Nx.confirm({
          title: isBlocked ? `Unblock ${name}?` : `Block ${name}?`,
          message: isBlocked
            ? 'They will be able to sign in and use their account again.'
            : 'They will be signed out right away and cannot sign in until you unblock them.',
          confirmLabel: isBlocked ? 'Unblock' : 'Block customer',
          tone: isBlocked ? 'primary' : 'danger',
        });
        if (!confirmed) return;
        Nx.busy(button, true, isBlocked ? 'Unblocking…' : 'Blocking…');
        try {
          const result = await Nx.api(
            `/api/admin/customers/${encodeURIComponent(button.dataset.blockUser)}/block`,
            {method: 'PATCH', body: {isBlocked: !isBlocked}},
          );
          Nx.busy(button, false);
          const nowBlocked = result.customer.isBlocked;
          const row = button.closest('tr');
          const status = row.querySelector('[data-status]');
          status.textContent = nowBlocked ? 'Blocked' : 'Active';
          status.className = `pill ${nowBlocked ? 'pill-red' : 'pill-green'}`;
          button.dataset.blocked = String(nowBlocked);
          button.textContent = nowBlocked ? 'Unblock' : 'Block';
          button.setAttribute(
            'aria-label',
            `${nowBlocked ? 'Unblock' : 'Block'} ${name}`,
          );
          button.className = `btn btn-sm ${nowBlocked ? 'btn-secondary' : 'btn-danger-soft'}`;
          Nx.toast(result.message);
        } catch (error) {
          Nx.busy(button, false);
          Nx.toast(error.message, 'error');
        }
      },
      {signal},
    );
  });

  // ---------- Product questions (E3): answer as the team, hide or show ----------
  Pages.define('admin-questions', (root, signal) => {
    root.addEventListener(
      'submit',
      async (event) => {
        const form = event.target.closest('[data-qa-answer-form]');
        if (!form) return;
        event.preventDefault();
        const id = form.closest('[data-question]').dataset.question;
        const reply = await Nx.submitForm(form, {
          url: `/api/admin/questions/${encodeURIComponent(id)}/answers`,
          busyLabel: 'Posting…',
        });
        if (reply) {
          Nx.toast(reply.message);
          window.location.reload();
        }
      },
      {signal},
    );
    root.addEventListener(
      'click',
      async (event) => {
        const button = event.target.closest('[data-qa-hide]');
        if (!button) return;
        const id = button.closest('[data-question]').dataset.question;
        Nx.busy(button, true, 'Saving…');
        try {
          const reply = await Nx.api(
            `/api/admin/questions/${encodeURIComponent(id)}/hidden`,
            {method: 'PATCH', body: {hidden: button.dataset.qaHide === 'true'}},
          );
          Nx.toast(reply.message);
          window.location.reload();
        } catch (error) {
          Nx.busy(button, false);
          Nx.toast(error.message, 'error');
        }
      },
      {signal},
    );
  });

  // ---------- Settings: store numbers an admin may change ----------
  Pages.define('admin-settings', (root, signal) => {
    root.addEventListener(
      'submit',
      async (event) => {
        const form = event.target.closest('[data-settings-form]');
        if (!form) return;
        event.preventDefault();
        const reply = await Nx.submitForm(form, {
          url: `/api/admin/settings/${form.dataset.settingsForm}`,
          method: 'PATCH',
          busyLabel: 'Saving…',
        });
        if (reply) Nx.toast(reply.message);
      },
      {signal},
    );

    // The section menu marks the card in view, and keeps that link visible on phones.
    const links = [...root.querySelectorAll('[data-settings-link]')];
    if (!links.length || !('IntersectionObserver' in window)) return;
    const mark = (id) =>
      links.forEach((link) => {
        const on = link.dataset.settingsLink === id;
        link.classList.toggle('is-current', on);
        if (on) {
          link.setAttribute('aria-current', 'true');
          link.scrollIntoView({block: 'nearest', inline: 'nearest'});
        } else link.removeAttribute('aria-current');
      });
    const observer = new IntersectionObserver(
      (entries) => {
        const seen = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (seen.length) mark(seen[0].target.id.replace(/^set-/, ''));
      },
      {rootMargin: '-20% 0px -60% 0px'},
    );
    root
      .querySelectorAll('.settings-card[id]')
      .forEach((card) => observer.observe(card));
    signal.addEventListener('abort', () => observer.disconnect());
    mark(links[0].dataset.settingsLink);
  });

  // ---------- Tables that scroll can be reached by keyboard ----------
  // A table wider (or taller) than its box scrolls, so keyboard users must be able to focus it and use the
  // arrow keys (WCAG 2.1.1). Only boxes that really scroll get a tab stop, named after the table's caption
  // or the nearest heading. Checked again when a section loads (the console swaps them without a reload)
  // and when the window is resized.
  function labelScrollingTables() {
    document.querySelectorAll('.table-wrap').forEach((box) => {
      const scrolls =
        box.scrollWidth > box.clientWidth + 1 ||
        box.scrollHeight > box.clientHeight + 1;
      if (!scrolls) {
        if (box.dataset.scrollRegion) {
          box.removeAttribute('tabindex');
          box.removeAttribute('role');
          box.removeAttribute('aria-label');
          delete box.dataset.scrollRegion;
        }
        return;
      }
      if (box.dataset.scrollRegion) return;
      const caption = box.querySelector('caption');
      const section = box.closest('section, .panel, main');
      const heading = section && section.querySelector('h1, h2, h3');
      const name =
        (caption && caption.textContent.trim()) ||
        (heading && heading.textContent.trim()) ||
        'Table';
      box.dataset.scrollRegion = '1';
      box.setAttribute('tabindex', '0');
      box.setAttribute('role', 'region');
      box.setAttribute('aria-label', `${name}, scrolls`);
    });
  }
  let tableTimer = 0;
  const scheduleTables = () => {
    clearTimeout(tableTimer);
    tableTimer = setTimeout(labelScrollingTables, 150);
  };
  labelScrollingTables();
  window.addEventListener('resize', scheduleTables, {passive: true});
  const content =
    document.querySelector('.admin-content') || document.querySelector('main');
  if (content && 'MutationObserver' in window)
    new MutationObserver(scheduleTables).observe(content, {
      childList: true,
      subtree: true,
    });

  // ---------- System status: re-read the health check on demand ----------
  Pages.define('admin-system', (root, signal) => {
    root.addEventListener(
      'click',
      (event) => {
        if (!event.target.closest('[data-system-refresh]')) return;
        refresh('System status updated.');
      },
      {signal},
    );
  });
})();
