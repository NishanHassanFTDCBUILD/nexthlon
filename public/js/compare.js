// Compare: pick up to four products from any listing (the Compare button on a card), see them in a
// tray at the bottom, and open the table at /compare. The selection is kept in this browser only.
(function () {
  'use strict';

  const KEY = 'nx-compare';
  const MAX = 4;
  const read = () => {
    try {
      const list = JSON.parse(localStorage.getItem(KEY) || '[]');
      return Array.isArray(list)
        ? list.filter((s) => typeof s === 'string').slice(0, MAX)
        : [];
    } catch {
      return [];
    }
  };
  const write = (list) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(list));
    } catch {
      /* storage blocked: the selection just lasts this page */
    }
  };

  let tray = null;
  function drawTray(list) {
    if (!list.length) {
      if (tray) tray.hidden = true;
      return;
    }
    if (!tray) {
      tray = document.createElement('aside');
      tray.className = 'compare-tray';
      tray.setAttribute('aria-label', 'Products to compare');
      document.body.append(tray);
    }
    tray.hidden = false;
    tray.replaceChildren();
    const label = document.createElement('p');
    label.className = 'compare-tray-label';
    label.textContent =
      list.length +
      ' of ' +
      MAX +
      ' to compare' +
      (list.length < 2 ? ' (pick one more)' : '');
    const actions = document.createElement('div');
    actions.className = 'compare-tray-actions';
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'btn btn-ghost btn-sm';
    clear.textContent = 'Clear';
    clear.addEventListener('click', () => {
      write([]);
      sync();
    });
    const open = document.createElement('a');
    open.className =
      'btn btn-primary btn-sm' + (list.length < 2 ? ' is-disabled' : '');
    open.href = '/compare?items=' + encodeURIComponent(list.join(','));
    open.textContent = 'Compare';
    if (list.length < 2) open.setAttribute('aria-disabled', 'true');
    actions.append(clear, open);
    tray.append(label, actions);
  }

  function sync() {
    const list = read();
    document.querySelectorAll('[data-compare-toggle]').forEach((button) => {
      const on = list.includes(button.dataset.compareToggle);
      button.setAttribute('aria-pressed', String(on));
      button.classList.toggle('is-on', on);
      button.textContent = on ? 'Added to compare' : 'Compare';
    });
    drawTray(list);
  }

  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-compare-toggle]');
    if (!button) return;
    event.preventDefault();
    const slug = button.dataset.compareToggle;
    const list = read();
    if (list.includes(slug)) {
      write(list.filter((s) => s !== slug));
    } else if (list.length >= MAX) {
      if (window.Nx)
        Nx.toast(
          'You can compare up to four products. Remove one first.',
          'error',
        );
      return;
    } else {
      write([...list, slug]);
    }
    sync();
  });

  sync();
})();
