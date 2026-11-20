// Mini cart: the header cart button opens a panel with the items, a free-delivery bar and the subtotal.
// Data comes from GET /api/cart. Everything is built with textContent, so names cannot inject markup.
(function () {
  'use strict';

  const panel = document.getElementById('mini-cart');
  const scrim = document.querySelector('.mini-cart-scrim');
  const trigger = document.querySelector('[data-cart-link]');
  if (!panel || !trigger) return;

  const body = panel.querySelector('[data-mini-cart-body]');
  const bar = panel.querySelector('[data-mini-cart-bar]');
  const subtotalEl = panel.querySelector('[data-mini-cart-subtotal]');
  const checkout = panel.querySelector('[data-mini-cart-checkout]');
  const freeMin = Number(
    document.querySelector('[data-free-delivery]')?.dataset.freeDelivery || 0,
  );
  let lastFocus = null;

  const money = (paise) =>
    '₹' + Math.round(paise / 100).toLocaleString('en-IN');

  function line(item) {
    const row = document.createElement('div');
    row.className =
      'mini-cart-line' + (item.available ? '' : ' is-unavailable');
    if (item.image) {
      const img = document.createElement('img');
      img.src = item.image;
      img.alt = '';
      img.width = 56;
      img.height = 56;
      img.loading = 'lazy';
      row.appendChild(img);
    }
    const text = document.createElement('div');
    const name = document.createElement('a');
    name.href = '/products/' + encodeURIComponent(item.slug);
    name.className = 'mini-cart-name';
    name.textContent = item.name;
    const meta = document.createElement('small');
    meta.className = 'muted';
    meta.textContent = item.available
      ? [item.option, 'Qty ' + item.quantity].filter(Boolean).join(' · ')
      : item.reason || 'Not available';
    text.append(name, meta);
    const total = document.createElement('strong');
    total.className = 'mini-cart-total';
    total.textContent = item.available ? money(item.lineTotal) : '';
    row.append(text, total);
    return row;
  }

  function render(view) {
    const summary = view.summary || {};
    const items = view.items || [];
    body.replaceChildren();
    if (!items.length) {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = 'Your cart is empty. Find something you like.';
      body.appendChild(empty);
    } else {
      items.forEach((item) => body.appendChild(line(item)));
    }

    if (summary.freeDeliveryGap > 0) {
      bar.textContent =
        'Add ' + money(summary.freeDeliveryGap) + ' more for free delivery.';
    } else if (items.length) {
      bar.textContent = 'You have free delivery on this order.';
    } else {
      bar.textContent = freeMin
        ? 'Free delivery on orders of ' + money(freeMin) + ' or more.'
        : '';
    }
    subtotalEl.textContent = money(summary.subtotal || 0);
    checkout.hidden = !items.length;
  }

  async function load() {
    body.replaceChildren();
    const status = document.createElement('p');
    status.className = 'muted';
    status.textContent = 'Loading your cart…';
    body.appendChild(status);
    try {
      const response = await fetch('/api/cart', {credentials: 'same-origin'});
      if (!response.ok) throw new Error('Your cart could not be loaded.');
      // GET /api/cart wraps the cart: {cart: {items, summary}}.
      const data = await response.json();
      render(data.cart || data);
    } catch (error) {
      body.replaceChildren();
      const failed = document.createElement('p');
      failed.className = 'muted';
      failed.textContent = error.message;
      body.appendChild(failed);
    }
  }

  function open() {
    lastFocus = document.activeElement;
    panel.hidden = false;
    scrim.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    panel.focus();
    load();
  }

  function close() {
    panel.hidden = true;
    scrim.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  trigger.addEventListener('click', (event) => {
    // The cart page itself, and modified clicks (new tab), keep the normal link.
    if (
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      location.pathname === '/cart'
    )
      return;
    event.preventDefault();
    open();
  });
  panel
    .querySelectorAll('[data-mini-cart-close]')
    .forEach((button) => button.addEventListener('click', close));
  scrim.addEventListener('click', close);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !panel.hidden) close();
  });
})();
