// Header: the search panel (ideas before typing, live suggestions while typing) and the phone menu drawer.
// The category mega-menu and the account menu use the shared [data-menu] code in app.js.
(function () {
  'use strict';

  // ---------- Phone menu drawer (a <dialog>: the browser keeps focus inside and handles Escape) ----------
  document.querySelectorAll('[data-drawer-open]').forEach((opener) => {
    const drawer = document.getElementById(opener.dataset.drawerOpen);
    if (!drawer || typeof drawer.showModal !== 'function') return;
    opener.addEventListener('click', () => {
      drawer.showModal();
      opener.setAttribute('aria-expanded', 'true');
      document.body.classList.add('drawer-open');
    });
    drawer.addEventListener('close', () => {
      opener.setAttribute('aria-expanded', 'false');
      document.body.classList.remove('drawer-open');
    });
    // A click on the dimmed backdrop lands on the dialog itself, outside its content.
    drawer.addEventListener('click', (event) => {
      if (event.target === drawer) drawer.close();
    });
    drawer
      .querySelectorAll('[data-drawer-close]')
      .forEach((button) =>
        button.addEventListener('click', () => drawer.close()),
      );
    window
      .matchMedia('(min-width: 1025px)')
      .addEventListener('change', (event) => {
        if (event.matches && drawer.open) drawer.close();
      });
  });

  // ---------- Live search suggestions ----------
  const form = document.querySelector('[data-search]');
  const input = form && form.querySelector('input[name="q"]');
  const box = form && form.querySelector('[data-suggest]');
  if (!form || !input || !box) return;

  const list = box.querySelector('[data-suggest-list]');
  const status = box.querySelector('[data-suggest-status]');
  const category = form.querySelector('select[name="category"]');
  const DEBOUNCE_MS = 250;
  const MAX_SUGGESTIONS = 6;
  let timer = 0;
  let controller = null;
  let options = [];
  let active = -1;

  // While searching: the bar glows, the page behind dims (a scrim under the header), and on a phone the
  // search becomes a full-screen sheet with a back button. All of it goes when the search closes.
  const phone = window.matchMedia('(max-width: 720px)');
  const scrim = document.createElement('div');
  scrim.className = 'search-scrim';
  scrim.setAttribute('aria-hidden', 'true');
  scrim.hidden = true;
  document.body.append(scrim);
  scrim.addEventListener('click', () => close());
  const back = form.querySelector('[data-search-back]');

  function engage() {
    form.classList.add('is-active');
    if (phone.matches) {
      form.classList.add('is-sheet');
      document.documentElement.classList.add('search-sheet-open');
    } else {
      scrim.hidden = false;
      requestAnimationFrame(() => scrim.classList.add('is-on'));
    }
  }

  function release() {
    form.classList.remove('is-active', 'is-sheet');
    document.documentElement.classList.remove('search-sheet-open');
    scrim.classList.remove('is-on');
    setTimeout(
      () => {
        if (!scrim.classList.contains('is-on')) scrim.hidden = true;
      },
      Nx.motionMs ? Nx.motionMs('--duration-medium', 320) : 320,
    );
  }

  function open() {
    box.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    engage();
  }

  function close() {
    clearTimeout(timer);
    if (controller) controller.abort();
    box.hidden = true;
    box.classList.remove('is-start');
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
    release();
  }

  if (back) {
    back.addEventListener('click', () => {
      close();
      input.blur();
    });
  }
  phone.addEventListener('change', () => {
    if (!box.hidden) engage();
  });

  function setStatus(text, tone = '') {
    status.textContent = text;
    status.className = `suggest-status${tone ? ` is-${tone}` : ''}`;
  }

  function highlight(target, text, query) {
    // Bold the typed text inside the product name, built from text nodes so nothing is read as HTML.
    const at = text.toLowerCase().indexOf(query.toLowerCase());
    if (at < 0) {
      target.textContent = text;
      return;
    }
    const mark = document.createElement('mark');
    mark.textContent = text.slice(at, at + query.length);
    target.append(text.slice(0, at), mark, text.slice(at + query.length));
  }

  function option(id, href) {
    const item = document.createElement('li');
    item.id = id;
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', 'false');
    const link = document.createElement('a');
    link.href = href;
    link.tabIndex = -1;
    item.append(link);
    return {item, link};
  }

  // corrected: the spelling-corrected words when the words as typed found nothing ("shoees" -> "shoes").
  function render(products, query, corrected) {
    list.replaceChildren();
    options = [];
    active = -1;
    input.removeAttribute('aria-activedescendant');

    products.slice(0, MAX_SUGGESTIONS).forEach((product, index) => {
      const {item, link} = option(
        `suggest-${index}`,
        `/products/${encodeURIComponent(product.slug)}`,
      );
      link.className = 'suggest-item';
      const img = document.createElement('img');
      img.alt = '';
      img.width = 44;
      img.height = 44;
      img.loading = 'lazy';
      if (/^(\/|https:\/\/)/.test(product.image || ''))
        img.src = Nx.photoSized(product.image, 96);
      const text = document.createElement('span');
      text.className = 'suggest-text';
      const name = document.createElement('span');
      name.className = 'suggest-name';
      highlight(name, product.name, query);
      const meta = document.createElement('span');
      meta.className = 'suggest-meta';
      meta.textContent = [product.category, Nx.formatPrice(product.price)]
        .filter(Boolean)
        .join(' · ');
      text.append(name, meta);
      link.append(img, text);
      list.append(item);
      options.push(item);
    });

    const params = new URLSearchParams({q: query});
    if (category && category.value) params.set('category', category.value);
    const {item, link} = option('suggest-all', `/products?${params}`);
    link.className = 'suggest-all';
    link.textContent = `See all results for "${query}"`;
    list.append(item);
    options.push(item);

    const shown = Math.min(products.length, MAX_SUGGESTIONS);
    const count = `${shown} ${shown === 1 ? 'suggestion' : 'suggestions'}`;
    setStatus(
      products.length
        ? `${corrected ? `Showing results for "${corrected}". ` : ''}${count}. Use the up and down arrows to choose.`
        : `No products match "${query}". Press Enter to search anyway.`,
      products.length ? '' : 'empty',
    );
    open();
  }

  async function lookup(query) {
    if (controller) controller.abort();
    controller = new AbortController();
    const params = new URLSearchParams({q: query});
    if (category && category.value) params.set('category', category.value);
    list.replaceChildren();
    options = [];
    box.classList.remove('is-start');
    setStatus('Searching…', 'loading');
    open();
    try {
      const response = await fetch(`/api/products/search?${params}`, {
        headers: {Accept: 'application/json'},
        credentials: 'same-origin',
        signal: controller.signal,
      });
      if (!response.ok) throw new Error('search failed');
      const data = await response.json();
      if (input.value.trim() !== query) return;
      render(
        Array.isArray(data.products) ? data.products : [],
        query,
        typeof data.correctedQuery === 'string' ? data.correctedQuery : '',
      );
    } catch (error) {
      if (error.name === 'AbortError') return;
      setStatus(
        'Suggestions are not available right now. Press Enter to search.',
        'error',
      );
    }
  }

  function move(step) {
    if (box.hidden || !options.length) return;
    if (active >= 0) options[active].setAttribute('aria-selected', 'false');
    active = (active + step + options.length) % options.length;
    const current = options[active];
    current.setAttribute('aria-selected', 'true');
    input.setAttribute('aria-activedescendant', current.id);
    current.scrollIntoView({block: 'nearest'});
  }

  // ---------- Before typing: the start panel ----------
  // A click in the empty search box opens a panel straight away: this device's recent searches, popular
  // searches, sports to jump to and products popular right now (GET /api/search/start, the same for
  // everyone). Typing two letters swaps it for live suggestions; clearing the box brings it back.
  const RECENT_KEY = 'nx-recent-searches';
  const RECENT_MAX = 6;
  let startData = null;
  let startLoading = null;

  const readRecent = () => {
    try {
      const value = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
      return Array.isArray(value)
        ? value
            .filter((term) => typeof term === 'string' && term.trim())
            .slice(0, RECENT_MAX)
        : [];
    } catch {
      return [];
    }
  };
  const writeRecent = (terms) => {
    try {
      localStorage.setItem(
        RECENT_KEY,
        JSON.stringify(terms.slice(0, RECENT_MAX)),
      );
    } catch {
      /* storage blocked: recent searches are simply not kept */
    }
  };
  // Newest first, no repeats (whatever the letter case).
  const rememberSearch = (term) => {
    const clean = String(term || '')
      .trim()
      .slice(0, 80);
    if (clean.length < 2) return;
    writeRecent([
      clean,
      ...readRecent().filter(
        (other) => other.toLowerCase() !== clean.toLowerCase(),
      ),
    ]);
  };

  const loadStart = () => {
    if (startData) return Promise.resolve(startData);
    if (!startLoading) {
      startLoading = fetch('/api/search/start', {
        headers: {Accept: 'application/json'},
        credentials: 'same-origin',
      })
        .then((response) => (response.ok ? response.json() : null))
        .then((data) => {
          startData = data;
          return data;
        })
        .catch(() => null)
        .finally(() => {
          startLoading = null;
        });
    }
    return startLoading;
  };

  const searchHref = (term) => `/products?${new URLSearchParams({q: term})}`;
  let order = 0; // the order items appear in, for the staggered entrance (style.css)

  // One group of options with a heading: <li role="group"> holding a heading and its options.
  function group(key, title, {chips = false, action = null} = {}) {
    const wrap = document.createElement('li');
    wrap.className = `suggest-group${chips ? ' is-chips' : ''}`;
    wrap.setAttribute('role', 'group');
    wrap.setAttribute('aria-labelledby', `suggest-head-${key}`);
    const head = document.createElement('div');
    head.className = 'suggest-head';
    const label = document.createElement('span');
    label.id = `suggest-head-${key}`;
    label.textContent = title;
    head.append(label);
    if (action) head.append(action);
    const body = document.createElement('div');
    body.className = 'suggest-group-body';
    wrap.append(head, body);
    list.append(wrap);
    return body;
  }

  function startOption(body, id, href, className) {
    const item = document.createElement('div');
    item.id = id;
    item.className = `suggest-option ${className}`;
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', 'false');
    item.style.setProperty('--i', String(order++));
    const link = document.createElement('a');
    link.href = href;
    link.tabIndex = -1;
    item.append(link);
    body.append(item);
    options.push(item);
    return link;
  }

  const icon = (name, extra = '') =>
    `<svg class="i ${extra}" aria-hidden="true" focusable="false"><use href="/img/icons.svg#${name}"></use></svg>`;

  function renderStart() {
    list.replaceChildren();
    options = [];
    active = -1;
    order = 0;
    input.removeAttribute('aria-activedescendant');
    box.classList.add('is-start');

    const recent = readRecent();
    if (recent.length) {
      const clear = document.createElement('button');
      clear.type = 'button';
      clear.className = 'suggest-clear';
      clear.textContent = 'Clear';
      clear.setAttribute('aria-label', 'Clear recent searches');
      clear.addEventListener('click', () => {
        writeRecent([]);
        renderStart();
        input.focus();
      });
      const body = group('recent', 'Recent searches', {action: clear});
      recent.forEach((term, index) => {
        const link = startOption(
          body,
          `suggest-recent-${index}`,
          searchHref(term),
          'suggest-recent',
        );
        link.innerHTML = icon('history', 'i-sm');
        const text = document.createElement('span');
        text.textContent = term;
        link.append(text);
        link.dataset.term = term;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'suggest-remove';
        remove.tabIndex = -1;
        remove.innerHTML = icon('x', 'i-xs');
        remove.setAttribute(
          'aria-label',
          `Remove "${term}" from recent searches`,
        );
        remove.addEventListener('click', (event) => {
          event.preventDefault();
          writeRecent(readRecent().filter((other) => other !== term));
          renderStart();
          input.focus();
        });
        link.parentElement.append(remove);
      });
    }

    const data = startData;
    if (data && data.searches && data.searches.length) {
      const body = group('popular', 'Trending searches', {chips: true});
      data.searches.forEach((entry, index) => {
        const link = startOption(
          body,
          `suggest-popular-${index}`,
          searchHref(entry.term),
          'suggest-chip',
        );
        link.innerHTML = icon('trending-up', 'i-xs');
        const text = document.createElement('span');
        text.textContent = entry.term;
        link.append(text);
        link.dataset.term = entry.term;
      });
    }
    if (data && data.sports && data.sports.length) {
      const body = group('sports', 'Shop by sport', {chips: true});
      data.sports.forEach((sport, index) => {
        const link = startOption(
          body,
          `suggest-sport-${index}`,
          `/products?${new URLSearchParams({category: sport.slug})}`,
          'suggest-sport',
        );
        if (/^(\/|https:\/\/)/.test(sport.image || '')) {
          const img = document.createElement('img');
          img.alt = '';
          img.width = 28;
          img.height = 28;
          img.loading = 'lazy';
          img.src = Nx.photoSized(sport.image, 96);
          link.append(img);
        }
        const text = document.createElement('span');
        text.textContent = sport.name;
        link.append(text);
      });
    }
    if (data && data.products && data.products.length) {
      const body = group('products', 'Popular right now');
      data.products.forEach((product, index) => {
        const link = startOption(
          body,
          `suggest-product-${index}`,
          `/products/${encodeURIComponent(product.slug)}`,
          'suggest-product',
        );
        link.className = 'suggest-item';
        const img = document.createElement('img');
        img.alt = '';
        img.width = 44;
        img.height = 44;
        img.loading = 'lazy';
        if (/^(\/|https:\/\/)/.test(product.image || ''))
          img.src = Nx.photoSized(product.image, 96);
        const text = document.createElement('span');
        text.className = 'suggest-text';
        const name = document.createElement('span');
        name.className = 'suggest-name';
        name.textContent = product.name;
        const meta = document.createElement('span');
        meta.className = 'suggest-meta';
        meta.textContent = [product.category, Nx.formatPrice(product.price)]
          .filter(Boolean)
          .join(' · ');
        text.append(name, meta);
        link.append(img, text);
      });
    }

    if (!options.length) {
      // Nothing to show yet (first visit, still loading): keep it closed rather than an empty box.
      if (!startData) setStatus('Loading ideas…', 'loading');
      else {
        close();
        return;
      }
    } else {
      setStatus('');
    }
    open();
  }

  // Opens the start panel when the box is empty (or holds less than two letters).
  function showStart() {
    if (input.value.trim().length >= 2) return;
    renderStart();
    if (!startData)
      loadStart().then(() => {
        if (document.activeElement === input && input.value.trim().length < 2)
          renderStart();
      });
  }

  input.addEventListener('focus', showStart);
  input.addEventListener('click', () => {
    if (box.hidden) showStart();
  });
  // Fetch the panel's data as soon as the visitor heads for the box, so it is there when they click.
  form.addEventListener('pointerenter', loadStart, {once: true});

  input.addEventListener('input', () => {
    clearTimeout(timer);
    const query = input.value.trim();
    if (query.length < 2) {
      showStart();
      return;
    }
    box.classList.remove('is-start');
    timer = setTimeout(() => lookup(query), DEBOUNCE_MS);
  });

  // A search, a popular search or a recent one is remembered on this device.
  form.addEventListener('submit', () => rememberSearch(input.value));
  list.addEventListener('click', (event) => {
    const link = event.target.closest('a[data-term]');
    if (link) rememberSearch(link.dataset.term);
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (box.hidden) {
        event.preventDefault();
        if (input.value.trim().length >= 2) lookup(input.value.trim());
        else showStart();
        return;
      }
      event.preventDefault();
      move(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Enter' && active >= 0 && !box.hidden) {
      event.preventDefault();
      const link = options[active].querySelector('a');
      if (link.dataset.term) rememberSearch(link.dataset.term);
      window.location.assign(link.href);
    } else if (
      event.key === 'Delete' &&
      active >= 0 &&
      !box.hidden &&
      options[active].classList.contains('suggest-recent')
    ) {
      // Delete removes the highlighted recent search, as in a browser's address bar.
      event.preventDefault();
      const term = options[active].querySelector('a').dataset.term;
      writeRecent(readRecent().filter((other) => other !== term));
      renderStart();
    } else if (event.key === 'Escape' && !box.hidden) {
      event.preventDefault();
      close();
    }
  });

  if (category)
    category.addEventListener('change', () => {
      if (input.value.trim().length >= 2) lookup(input.value.trim());
    });

  // Keep the cursor in the search box while a suggestion is clicked (the keyboard stays up on a phone).
  box.addEventListener('pointerdown', (event) => event.preventDefault());
  form.addEventListener('focusout', (event) => {
    if (!form.contains(event.relatedTarget)) close();
  });
  document.addEventListener('click', (event) => {
    if (!form.contains(event.target)) close();
  });
  form.addEventListener('submit', close);
})();
