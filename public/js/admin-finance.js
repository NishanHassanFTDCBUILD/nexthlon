// Delegated so finance filters also work after a section switch.
(function () {
  'use strict';
  document.addEventListener(
    'submit',
    (event) => {
      const form = event.target.closest('.sales-workspace [data-filter-form]');
      if (!form) return;
      const from = form.elements.from;
      const to = form.elements.to;
      if (!from || !to) return;
      to.setCustomValidity('');
      if (from.value && to.value && from.value > to.value) {
        event.preventDefault();
        event.stopImmediatePropagation();
        to.setCustomValidity(
          'The end date must be on or after the start date.',
        );
        const panel = to.closest('details');
        if (panel) panel.open = true;
        to.reportValidity();
        to.focus();
      }
    },
    true,
  );
  document.addEventListener('input', (event) => {
    const form = event.target.closest('.sales-workspace [data-filter-form]');
    if (form && form.elements.to) form.elements.to.setCustomValidity('');
  });
})();
