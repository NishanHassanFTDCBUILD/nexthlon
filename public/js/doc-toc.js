// Policy pages (privacy, terms, refunds, shipping): an "On this page" list built from the section headings,
// so a long legal page can be skimmed and each section linked to. Without JavaScript the page reads as before.
(function () {
  'use strict';

  const doc = document.querySelector('.doc[data-toc]');
  if (!doc) return;
  const headings = [...doc.querySelectorAll('h2')];
  if (headings.length < 4) return;

  const slug = (text) =>
    text
      .toLowerCase()
      .replace(/^\d+\.\s*/, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

  const nav = document.createElement('nav');
  nav.className = 'doc-toc';
  nav.setAttribute('aria-label', 'On this page');
  const title = document.createElement('p');
  title.className = 'doc-toc-title';
  title.textContent = 'On this page';
  const list = document.createElement('ol');

  headings.forEach((heading) => {
    if (!heading.id)
      heading.id =
        slug(heading.textContent) || `section-${list.children.length + 1}`;
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.href = `#${heading.id}`;
    link.textContent = heading.textContent.replace(/^\d+\.\s*/, '');
    item.append(link);
    list.append(item);
  });

  nav.append(title, list);
  doc.prepend(nav);
})();
