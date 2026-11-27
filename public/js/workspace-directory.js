// Delegation keeps directories working after account and admin section swaps.
(function () {
  'use strict';
  function update(root) {
    const query = (root.querySelector('[data-directory-search]')?.value || '')
      .trim()
      .toLowerCase();
    const category =
      root.querySelector('[data-directory-filter].is-active')?.dataset
        .directoryFilter || 'all';
    let count = 0;
    root.querySelectorAll('[data-directory-item]').forEach((item) => {
      item.hidden = !(
        item.textContent.toLowerCase().includes(query) &&
        (category === 'all' || item.dataset.directoryCategory === category)
      );
      if (!item.hidden) count++;
    });
    root.querySelectorAll('[data-directory-group]').forEach((group) => {
      group.hidden = ![...group.querySelectorAll('[data-directory-item]')].some(
        (item) => !item.hidden,
      );
    });
    const empty = root.querySelector('[data-directory-empty]');
    if (empty) empty.hidden = count > 0;
    const label = root.querySelector('[data-directory-count]');
    if (label)
      label.textContent = `${count} ${count === 1 ? 'service' : 'services'}`;
  }
  document.addEventListener('input', (event) => {
    if (event.target.matches('[data-directory-search]'))
      update(event.target.closest('[data-workspace-directory]'));
  });
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-directory-filter]');
    if (!button) return;
    const root = button.closest('[data-workspace-directory]');
    root.querySelectorAll('[data-directory-filter]').forEach((item) => {
      const selected = item === button;
      item.classList.toggle('is-active', selected);
      item.setAttribute('aria-pressed', String(selected));
    });
    update(root);
  });
})();
