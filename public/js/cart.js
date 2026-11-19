// Add to cart on the product page, and the cart page (+/- quantity, remove, live totals).
// Prices shown here always come from the server's reply; the browser never sends a price.
(function () {
  'use strict';

  // Money from the API is in paise.
  const formatPrice = (value) => Nx.formatPrice(value);

  // ---------- Quantity stepper on the product page ----------
  function setupStepper(root) {
    const input = root.querySelector('[data-qty-input]');
    const minus = root.querySelector('[data-qty-step="-1"]');
    const plus = root.querySelector('[data-qty-step="1"]');
    const clamp = () => {
      // Read each time: choosing a size changes the most you can buy.
      const max = Number(input.max) || 1;
      const value = Math.min(
        max,
        Math.max(1, Math.round(Number(input.value)) || 1),
      );
      input.value = String(value);
      minus.disabled = value <= 1;
      plus.disabled = value >= max;
      return value;
    };
    root.querySelectorAll('[data-qty-step]').forEach((button) => {
      button.addEventListener('click', () => {
        input.value = String(
          (Number(input.value) || 1) + Number(button.dataset.qtyStep),
        );
        clamp();
      });
    });
    input.addEventListener('change', clamp);
    return clamp;
  }

  // ---------- Size and colour picker on the product page ----------
  // Every option (size, colour or both) has its own stock. Choosing one fills the hidden variantId,
  // updates "Only N left in size X" and the most you can buy, and crosses out the other choices that
  // are sold out with it. Add to cart and Buy now ask for a choice first (a gentle shake).
  function setupOptions(form) {
    const box = form.querySelector('[data-options]');
    if (!box) return () => null;
    let options = [];
    try {
      options =
        JSON.parse(box.querySelector('[data-options-json]').textContent) || [];
    } catch {
      options = [];
    }
    const hidden = box.querySelector('[data-variant-input]');
    const message = box.querySelector('[data-opt-msg]');
    const stockLine = document.querySelector('[data-stock-line]');
    const defaultStock = stockLine && {
      text: stockLine.textContent,
      className: stockLine.className,
    };
    const qty = form.querySelector('[data-qty-input]');
    const hint = form.querySelector('.pdx-hint');
    const groups = ['size', 'colour'].filter((name) =>
      box.querySelector(`[data-opt-group="${name}"]`),
    );
    const picked = (name) => {
      const input = box.querySelector(`input[name="${name}"]:checked`);
      return input ? input.value : '';
    };
    const fits = (option, choice) =>
      groups.every((name) => !choice[name] || option[name] === choice[name]);
    const firstName = groups[0] === 'colour' ? 'colour' : 'size';

    function stockText(option) {
      const name = [option.size && `size ${option.size}`, option.colour]
        .filter(Boolean)
        .join(', ');
      if (option.stock <= 0)
        return {text: `Sold out in ${name}`, tone: 'is-out'};
      if (option.stock <= 5)
        return {
          text: `Only ${option.stock} left in ${name} – order soon`,
          tone: 'is-low',
        };
      return {text: `In stock in ${name}`, tone: 'is-ok'};
    }

    function refresh() {
      const choice = Object.fromEntries(
        groups.map((name) => [name, picked(name)]),
      );
      // A choice in one group crosses out what is sold out with it in the other.
      groups.forEach((name) => {
        const others = {...choice, [name]: ''};
        box.querySelectorAll(`input[name="${name}"]`).forEach((input) => {
          const left = options
            .filter(
              (option) => option[name] === input.value && fits(option, others),
            )
            .reduce((sum, option) => sum + option.stock, 0);
          input.disabled = left <= 0;
          input.closest('.pdx-opt').classList.toggle('is-sold', left <= 0);
          if (input.disabled && input.checked) input.checked = false;
        });
        const label = box.querySelector(`[data-opt-picked="${name}"]`);
        if (label) label.textContent = picked(name);
        const clear = box.querySelector(`[data-opt-clear="${name}"]`);
        if (clear) clear.hidden = !picked(name);
      });
      const complete = groups.every((name) => picked(name));
      const match = complete
        ? options.find(
            (option) =>
              fits(option, choice) &&
              groups.every((name) => option[name] === choice[name]),
          )
        : null;
      hidden.value = match && match.stock > 0 ? match.id : '';
      box.classList.toggle('is-chosen', Boolean(hidden.value));
      if (match) {
        const {text, tone} = stockText(match);
        if (stockLine) {
          stockLine.textContent = text;
          stockLine.className = `pdx-stock ${tone}`;
        }
        if (qty) {
          const max = Math.max(1, Math.min(match.stock, 5));
          qty.max = String(max);
          qty.dispatchEvent(new Event('change'));
          if (hint) hint.textContent = `Max ${max} per order`;
        }
      } else {
        if (stockLine && defaultStock) {
          stockLine.textContent = defaultStock.text;
          stockLine.className = defaultStock.className;
        }
        if (qty) {
          qty.max = '1';
          qty.dispatchEvent(new Event('change'));
          if (hint) hint.textContent = 'Choose your options first';
        }
      }
      message.textContent = '';
      box.classList.remove('is-asking');
      // The gallery (catalog.js) shows the photos of the colour picked.
      const colour = picked('colour');
      if (colour !== shownColour) {
        shownColour = colour;
        document.dispatchEvent(
          new CustomEvent('nx:colour', {detail: {colour}}),
        );
      }
    }
    let shownColour = '';

    box.addEventListener('change', refresh);
    box.querySelectorAll('[data-opt-clear]').forEach((button) => {
      button.addEventListener('click', () => {
        const name = button.dataset.optClear;
        box.querySelectorAll(`input[name="${name}"]`).forEach((input) => {
          input.checked = false;
        });
        refresh();
        const first = box.querySelector(`input[name="${name}"]:not(:disabled)`);
        if (first) first.focus({preventScroll: true});
      });
    });
    // ?option=<id> (a link from the cart, or back from sign-in) chooses that option.
    const wanted = new URLSearchParams(window.location.search).get('option');
    const start = options.find((option) => option.id === wanted);
    if (start) {
      groups.forEach((name) => {
        const input = [...box.querySelectorAll(`input[name="${name}"]`)].find(
          (item) => item.value === start[name],
        );
        if (input && !input.disabled) input.checked = true;
      });
    }
    refresh();

    // Returns the chosen option id, or asks for one and returns null.
    return function requireOption() {
      if (hidden.value) return hidden.value;
      const missing = groups.find((name) => !picked(name)) || firstName;
      message.textContent =
        missing === 'colour'
          ? 'Choose a colour first.'
          : 'Choose a size first.';
      box.classList.remove('is-asking');
      void box.offsetWidth;
      box.classList.add('is-asking');
      const first = box.querySelector(
        `input[name="${missing}"]:not(:disabled)`,
      );
      const still = window.matchMedia(
        '(prefers-reduced-motion: reduce)',
      ).matches;
      box.scrollIntoView({
        block: 'nearest',
        behavior: still ? 'auto' : 'smooth',
      });
      if (first) first.focus({preventScroll: true});
      return null;
    };
  }

  const addForm = document.querySelector('[data-add-to-cart]');
  if (addForm) {
    const readQuantity = setupStepper(addForm.querySelector('[data-qty]'));
    const requireOption = setupOptions(addForm);
    // Product page code (product.js Buy now) asks the same question before going to checkout.
    addForm.nxRequireOption = () =>
      addForm.hasAttribute('data-has-options') ? requireOption() : null;
    // This page with the chosen option (and any extra query, such as buy=now), for after sign-in.
    addForm.nxReturnPath = (extra = {}) => {
      const params = new URLSearchParams(window.location.search);
      const chosen = addForm.querySelector('[data-variant-input]');
      if (chosen && chosen.value) params.set('option', chosen.value);
      else params.delete('option');
      Object.entries(extra).forEach(([key, value]) => params.set(key, value));
      const query = params.toString();
      return window.location.pathname + (query ? `?${query}` : '');
    };
    // The shared Nx.addToCart (store.js): the photo flies from the gallery the moment you press the button.
    addForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const variantId = addForm.nxRequireOption();
      if (addForm.hasAttribute('data-has-options') && !variantId) return;
      // Signed out: sign in first and come back here with the same size still chosen.
      if (Nx.shopperRole === 'guest')
        return Nx.signInFirst(addForm.nxReturnPath());
      // From the big photo, or from the sticky buy bar's photo when the big one has scrolled away.
      const gallery = document.querySelector('[data-gallery-main]');
      const box = gallery ? gallery.getBoundingClientRect() : null;
      const onScreen =
        box && box.bottom > 40 && box.top < window.innerHeight - 40;
      const result = await Nx.addToCart({
        productId: addForm.dataset.productId,
        quantity: readQuantity(),
        variantId,
        source: onScreen
          ? gallery
          : document.querySelector('[data-dock] img') || gallery,
        src: gallery ? gallery.currentSrc || gallery.src : '',
        button: addForm.querySelector('[type="submit"]'),
      });
      // The product page shows "N already in your cart" from this.
      if (result.ok)
        addForm.dispatchEvent(
          new CustomEvent('nx:cart-added', {detail: result.cart}),
        );
    });
  }

  // ---------- Cart page ----------
  const page = document.querySelector('[data-cart]');
  if (!page) return;
  const listPanel = page.querySelector('[data-cart-list-panel]');
  const summaryBox = page.querySelector('[data-cart-summary]');
  const empty = page.querySelector('[data-cart-empty]');
  const headingCount = page.querySelector('[data-cart-heading-count]');

  // A row leaving the cart folds back and away in 3D, then the rows below glide up into its place
  // (each measured before and after, so only transform moves). With reduced motion it simply goes.
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  function removeRow(row) {
    if (row.dataset.leaving) return row.leaving;
    row.dataset.leaving = 'true';
    if (reduced.matches || typeof row.animate !== 'function') {
      row.remove();
      return (row.leaving = Promise.resolve());
    }
    const others = [...row.parentElement.children].filter(
      (other) => other !== row,
    );
    const before = new Map(
      others.map((other) => [other, other.getBoundingClientRect().top]),
    );
    row.style.pointerEvents = 'none';
    row.style.transformOrigin = '50% 0%';
    const fold = row.animate(
      [
        {
          transform: 'perspective(900px) rotateX(0deg) translateZ(0)',
          opacity: 1,
        },
        {
          transform:
            'perspective(900px) rotateX(-78deg) translateZ(-60px) translateY(-10px)',
          opacity: 0,
        },
      ],
      {
        duration: Nx.motionMs('--duration-slow', 400),
        easing: Nx.motionEase('--ease-in-out'),
        fill: 'forwards',
      },
    );
    row.leaving = fold.finished
      .catch(() => {})
      .then(() => {
        row.remove();
        others.forEach((other) => {
          const shift = before.get(other) - other.getBoundingClientRect().top;
          if (shift)
            other.animate(
              [{transform: `translateY(${shift}px)`}, {transform: 'none'}],
              {
                duration: Nx.motionMs('--duration-medium', 320),
                easing: Nx.motionEase('--ease-out'),
              },
            );
        });
      });
    return row.leaving;
  }

  // Brings every number on the page in line with the cart the server sent back.
  function render(cart) {
    const {items, summary} = cart;
    // Rows are keyed by line ("<product>" or "<product>-<size option>"): two sizes are two rows.
    const byId = new Map(
      items.map((item) => [item.key || item.productId, item]),
    );
    const leaving = [];
    page.querySelectorAll('[data-cart-item]').forEach((row) => {
      const item = byId.get(row.dataset.cartItem);
      if (!item) {
        leaving.push(removeRow(row));
        return;
      }
      if (row.dataset.leaving) return;
      Nx.rollNumber(row.querySelector('[data-cart-qty]'), item.quantity);
      row.querySelector('[data-cart-line-total]').textContent = item.available
        ? formatPrice(item.lineTotal)
        : '—';
      row.querySelector('[data-cart-step="-1"]').disabled =
        !item.available || item.quantity <= 1;
      row.querySelector('[data-cart-step="1"]').disabled =
        !item.available || item.quantity >= item.maxQuantity;
    });

    const set = (key, text) =>
      page.querySelectorAll(`[data-summary="${key}"]`).forEach((el) => {
        el.textContent = text;
      });
    set('mrpTotal', formatPrice(summary.mrpTotal));
    set('savings', `−${formatPrice(summary.savings)}`);
    set('savings-plain', formatPrice(summary.savings));
    set('grandTotal', formatPrice(summary.grandTotal));
    set('freeDeliveryGap', formatPrice(summary.freeDeliveryGap));
    page.querySelectorAll('[data-summary="deliveryFee"]').forEach((el) => {
      if (summary.deliveryFee)
        el.textContent = formatPrice(summary.deliveryFee);
      else el.innerHTML = '<span class="text-success">Free</span>';
    });
    const freeNote = page.querySelector('[data-free-note]');
    if (freeNote) {
      freeNote.hidden = !summary.freeDeliveryGap;
      // The progress bar: how much of the way to the free-delivery amount the cart already is.
      const target = summary.subtotal + summary.freeDeliveryGap;
      const percent = target > 0 ? summary.subtotal / target : 1;
      const fill = freeNote.querySelector('[data-free-fill]');
      const meter = freeNote.querySelector('[role="meter"]');
      if (fill) fill.style.transform = 'scaleX(' + percent.toFixed(2) + ')';
      if (meter)
        meter.setAttribute('aria-valuenow', String(Math.round(percent * 100)));
    }
    const checkout = page.querySelector('[data-checkout-link]');
    if (checkout) {
      if (summary.itemCount) {
        checkout.removeAttribute('aria-disabled');
        checkout.removeAttribute('tabindex');
      } else {
        checkout.setAttribute('aria-disabled', 'true');
        checkout.setAttribute('tabindex', '-1');
      }
    }
    set('itemCount', String(summary.itemCount));
    page.querySelectorAll('[data-summary-items]').forEach((el) => {
      el.textContent = summary.itemCount === 1 ? 'item' : 'items';
    });
    const savingNote = page.querySelector('[data-summary-saving-note]');
    if (savingNote) savingNote.hidden = !(summary.savings > 0);
    const unavailableNote = page.querySelector('[data-cart-unavailable-note]');
    if (unavailableNote)
      unavailableNote.hidden = summary.unavailableCount === 0;
    headingCount.textContent = `${summary.count} ${summary.count === 1 ? 'item' : 'items'}`;

    const isEmpty = items.length === 0;
    // The last row folds away first, then the empty cart shows.
    const showEmpty = () => {
      listPanel.hidden = isEmpty;
      summaryBox.hidden = isEmpty;
      empty.hidden = !isEmpty;
    };
    if (isEmpty && leaving.length) Promise.all(leaving).then(showEmpty);
    else showEmpty();
    Nx.setCartCount(summary.count);
  }

  // Runs one cart change while the row shows it is busy. Errors leave the row as it was.
  async function change(row, request) {
    row.classList.add('is-busy');
    row.setAttribute('aria-busy', 'true');
    row.querySelectorAll('button').forEach((button) => {
      button.disabled = true;
    });
    try {
      const result = await request();
      render(result.cart);
      Nx.toast(result.message);
    } catch (error) {
      Nx.toast(error.message, 'error');
      // Reload the true state, so the buttons match the server again.
      try {
        render((await Nx.api('/api/cart')).cart);
      } catch {
        /* the first error toast is enough */
      }
    } finally {
      if (row.isConnected) {
        row.classList.remove('is-busy');
        row.removeAttribute('aria-busy');
        row
          .querySelectorAll('[data-cart-remove], [data-cart-save]')
          .forEach((button) => {
            button.disabled = false;
          });
      }
    }
  }

  page.addEventListener('click', async (event) => {
    const step = event.target.closest('[data-cart-step]');
    const remove = event.target.closest('[data-cart-remove]');
    const save = event.target.closest('[data-cart-save]');
    const row = event.target.closest('[data-cart-item]');
    if (!row || (!step && !remove && !save)) return;
    const id = encodeURIComponent(row.dataset.cartItem);

    if (save) {
      await change(row, async () => {
        const reply = await Nx.api(`/api/cart/items/${id}/save-for-later`, {
          method: 'POST',
        });
        if (Nx.applyWishlist) Nx.applyWishlist(reply.wishlist);
        return reply;
      });
      return;
    }

    if (step) {
      const shown = row.querySelector('[data-cart-qty]');
      const quantity =
        Number(shown.dataset.value || shown.textContent) +
        Number(step.dataset.cartStep);
      await change(row, () =>
        Nx.api(`/api/cart/items/${id}`, {method: 'PATCH', body: {quantity}}),
      );
      return;
    }
    const confirmed = await Nx.confirm({
      title: 'Remove this item?',
      message: `${row.dataset.name} will be taken out of your cart.`,
      confirmLabel: 'Remove',
    });
    if (confirmed)
      await change(row, () =>
        Nx.api(`/api/cart/items/${id}`, {method: 'DELETE'}),
      );
  });
})();
