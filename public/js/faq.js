// FAQ search: shows only the questions whose text (or answer) contains what is typed.
(function () {
  'use strict';

  const search = document.querySelector('[data-faq-search]');
  if (!search) return;
  const items = Array.from(document.querySelectorAll('[data-faq-item]'));
  const empty = document.querySelector('[data-faq-empty]');

  search.addEventListener('input', () => {
    const word = search.value.trim().toLowerCase();
    let shown = 0;
    items.forEach((item) => {
      const match = !word || item.textContent.toLowerCase().includes(word);
      item.hidden = !match;
      if (match) shown += 1;
    });
    if (empty) empty.hidden = shown > 0;
  });
})();
