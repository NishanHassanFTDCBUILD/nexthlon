// Admin Deals of the Day: the list (turn on/off, delete) and the create/edit form with a live
// deal price preview. The server checks everything again (utils/validators.js validateDeal) and
// works out the real price (utils/pricing.js), so the preview is only a guide.
(function () {
  'use strict';

  const Pages = window.NxPages;
  if (!Pages || !Pages.define) return;
  const go = (href) =>
    window.NxNav && window.NxNav.inArea(href)
      ? window.NxNav.go(href)
      : window.location.assign(href);
  // ₹1,759.20 or ₹2,199: paise only when there are some.
  const rupees = (paise) =>
    `₹${(paise / 100).toLocaleString('en-IN', {
      minimumFractionDigits: paise % 100 ? 2 : 0,
      maximumFractionDigits: 2,
    })}`;
  const LABELS = {
    live: ['Live now', 'pill-green'],
    scheduled: ['Starts later', 'pill-blue'],
    ended: ['Ended', 'pill-grey'],
    disabled: ['Turned off', 'pill-amber'],
  };

  // ---------- The list ----------
  Pages.define('admin-deals', (root, signal) => {
    root.addEventListener(
      'click',
      async (event) => {
        const toggle = event.target.closest('[data-deal-toggle]');
        const remove = event.target.closest('[data-deal-delete]');
        if (toggle) await toggleDeal(toggle);
        else if (remove) await deleteDeal(remove);
      },
      {signal},
    );

    async function toggleDeal(button) {
      const id = button.dataset.dealToggle;
      const active = button.dataset.active === 'true';
      const name = button.dataset.name;
      const ok = await Nx.confirm({
        title: active
          ? `Turn off the deal on ${name}?`
          : `Turn on the deal on ${name}?`,
        message: active
          ? 'The usual price comes back at once. Orders already placed keep their price.'
          : 'If it is inside its times, the deal price starts at once.',
        confirmLabel: active ? 'Turn it off' : 'Turn it on',
        tone: active ? 'danger' : 'primary',
      });
      if (!ok) return;
      Nx.busy(button, true, active ? 'Turning off…' : 'Turning on…');
      try {
        const reply = await Nx.api(
          `/api/admin/deals/${encodeURIComponent(id)}/active`,
          {method: 'PATCH', body: {isActive: !active}},
        );
        Nx.busy(button, false);
        const deal = reply.deal;
        button.dataset.active = String(deal.isActive);
        button.textContent = deal.isActive ? 'Turn off' : 'Turn on';
        button.className = `btn btn-sm ${deal.isActive ? 'btn-danger-soft' : 'btn-secondary'}`;
        button.setAttribute(
          'aria-label',
          `${deal.isActive ? 'Turn off' : 'Turn on'} the deal on ${name}`,
        );
        const row = button.closest('[data-deal-row]');
        const pill = row && row.querySelector('[data-deal-status]');
        if (pill && LABELS[deal.status]) {
          pill.textContent = LABELS[deal.status][0];
          pill.className = `pill ${LABELS[deal.status][1]}`;
        }
        Nx.toast(reply.message);
      } catch (error) {
        Nx.busy(button, false);
        Nx.toast(error.message, 'error');
      }
    }

    async function deleteDeal(button) {
      const id = button.dataset.dealDelete;
      const ok = await Nx.confirm({
        title: `Delete the deal on ${button.dataset.name}?`,
        message:
          'If it is live, the usual price comes back at once. Orders already placed keep their price.',
        confirmLabel: 'Delete the deal',
      });
      if (!ok) return;
      Nx.busy(button, true, 'Deleting…');
      try {
        const reply = await Nx.api(
          `/api/admin/deals/${encodeURIComponent(id)}`,
          {method: 'DELETE'},
        );
        const row = button.closest('[data-deal-row]');
        if (row) row.remove();
        Nx.toast(reply.message);
      } catch (error) {
        Nx.busy(button, false);
        Nx.toast(error.message, 'error');
      }
    }
  });

  // ---------- The create / edit form ----------
  // A product picker (search, click to add or remove), a deal price on each chosen product, and
  // quick lengths. Creating takes up to 20 products; editing keeps exactly one.
  const MAX_PICKS = 20;
  const dealPrice = (base, off) => Math.floor((base * (100 - off)) / 100 + 0.5);

  Pages.define('admin-deal-form', (root, signal) => {
    const form = root.querySelector('[data-deal-form]');
    if (!form) return;
    const single = form.dataset.mode === 'single';
    const search = form.querySelector('[data-pick-search]');
    const results = form.querySelector('[data-pick-results]');
    const picked = form.querySelector('[data-picked]');
    const empty = form.querySelector('[data-picked-empty]');
    const count = form.querySelector('[data-picked-count]');
    const submitLabel = form.querySelector('[data-deal-submit-label]');
    const percent = form.querySelector('[data-deal-percent]');

    const chosenIds = () =>
      [...picked.querySelectorAll('[data-pick-id]')].map(
        (chip) => chip.dataset.pickId,
      );

    // Each chip shows its deal price ("₹2,999 → ₹2,099") once a discount is typed.
    function refresh() {
      const off = Number(percent.value);
      const valid = off >= 1 && off <= 90;
      picked.querySelectorAll('[data-pick-id]').forEach((chip) => {
        const base = Number(chip.dataset.base);
        const price = chip.querySelector('[data-chip-price]');
        price.textContent = valid
          ? `${rupees(base)} → ${rupees(dealPrice(base, off))}`
          : rupees(base);
      });
      const n = chosenIds().length;
      count.textContent = String(n);
      empty.hidden = n > 0;
      if (submitLabel && !single)
        submitLabel.textContent =
          n > 1 ? `Create ${n} deals` : 'Create the deal';
      results.querySelectorAll('[data-pick-result]').forEach((button) => {
        const on = chosenIds().includes(button.dataset.pickResult);
        button.classList.toggle('is-picked', on);
        button.setAttribute('aria-pressed', String(on));
      });
    }

    function chipFor(p) {
      const chip = document.createElement('li');
      chip.className = 'deal-chip';
      chip.dataset.pickId = p.id;
      chip.dataset.base = p.basePrice;
      chip.dataset.mrp = p.mrp;
      const img = document.createElement('img');
      img.src = p.image;
      img.alt = '';
      img.width = 40;
      img.height = 40;
      const text = document.createElement('span');
      text.className = 'deal-chip-text';
      const name = document.createElement('strong');
      name.textContent = p.name;
      const meta = document.createElement('small');
      meta.className = 'muted';
      const price = document.createElement('span');
      price.dataset.chipPrice = '';
      meta.append(
        price,
        ` · ${p.stock ? `${p.stock} in stock` : 'Out of stock'}${p.isListed ? '' : ' · unlisted'}`,
      );
      text.append(name, meta);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn btn-ghost btn-sm btn-square';
      remove.dataset.pickRemove = '';
      remove.setAttribute('aria-label', `Remove ${p.name}`);
      remove.innerHTML =
        '<svg class="i i-xs" aria-hidden="true" focusable="false"><use href="/img/icons.svg#x"></use></svg>';
      chip.append(img, text, remove);
      return chip;
    }

    function toggle(p) {
      const existing = picked.querySelector(`[data-pick-id="${p.id}"]`);
      if (existing) {
        if (!single) existing.remove();
      } else {
        if (single) picked.replaceChildren();
        else if (chosenIds().length >= MAX_PICKS) {
          Nx.toast(`Up to ${MAX_PICKS} products at a time.`, 'error');
          return;
        }
        picked.append(chipFor(p));
      }
      form.dispatchEvent(new Event('input', {bubbles: true}));
      refresh();
    }

    // Results of the last search, by id, so a click knows the product.
    let found = new Map();
    let timer = 0;
    let request = 0;
    async function runSearch() {
      const mine = (request += 1);
      try {
        const reply = await Nx.api(
          `/api/admin/deals/products?q=${encodeURIComponent(search.value.trim())}`,
        );
        if (mine !== request) return;
        found = new Map(reply.products.map((p) => [p.id, p]));
        results.replaceChildren(
          ...reply.products.map((p) => {
            const li = document.createElement('li');
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'deal-result';
            button.dataset.pickResult = p.id;
            const img = document.createElement('img');
            img.src = p.image;
            img.alt = '';
            img.width = 32;
            img.height = 32;
            const name = document.createElement('span');
            name.className = 'deal-result-name';
            name.textContent = p.name;
            const meta = document.createElement('small');
            meta.className = 'muted';
            meta.textContent = `${rupees(p.basePrice)} · ${p.stock ? `${p.stock} in stock` : 'out of stock'}${p.isListed ? '' : ' · unlisted'}`;
            button.append(img, name, meta);
            li.append(button);
            return li;
          }),
        );
        if (!reply.products.length) {
          const li = document.createElement('li');
          li.className = 'muted deal-results-empty';
          li.textContent = 'No product matches that name.';
          results.append(li);
        }
        refresh();
      } catch (error) {
        Nx.toast(error.message, 'error');
      }
    }
    search.addEventListener(
      'input',
      () => {
        clearTimeout(timer);
        timer = setTimeout(runSearch, 200);
      },
      {signal},
    );
    // The search box is not part of the deal: Enter searches instead of submitting.
    search.addEventListener(
      'keydown',
      (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        clearTimeout(timer);
        runSearch();
      },
      {signal},
    );
    results.addEventListener(
      'click',
      (event) => {
        const button = event.target.closest('[data-pick-result]');
        if (button && found.has(button.dataset.pickResult))
          toggle(found.get(button.dataset.pickResult));
      },
      {signal},
    );
    picked.addEventListener(
      'click',
      (event) => {
        const remove = event.target.closest('[data-pick-remove]');
        if (!remove) return;
        if (single) {
          Nx.toast('Pick another product above to swap it.');
          return;
        }
        remove.closest('[data-pick-id]').remove();
        form.dispatchEvent(new Event('input', {bubbles: true}));
        refresh();
      },
      {signal},
    );
    percent.addEventListener('input', refresh, {signal});

    // Quick lengths: the end is the start plus this many hours (local Indian time strings).
    form.addEventListener(
      'click',
      (event) => {
        const button = event.target.closest('[data-deal-length]');
        if (!button) return;
        const start = form.elements.startsAt.value;
        if (!start) return;
        const at = new Date(`${start}:00Z`);
        at.setUTCHours(at.getUTCHours() + Number(button.dataset.dealLength));
        form.elements.endsAt.value = at.toISOString().slice(0, 16);
        form.dispatchEvent(new Event('input', {bubbles: true}));
      },
      {signal},
    );

    runSearch();
    refresh();

    form.addEventListener(
      'submit',
      async (event) => {
        event.preventDefault();
        const body = Nx.formValues(form);
        delete body[''];
        body.isActive = form.elements.isActive.checked;
        const ids = chosenIds();
        if (single) body.product = ids[0] || '';
        else body.products = ids;
        const reply = await Nx.submitForm(form, {
          url: form.dataset.endpoint,
          method: form.dataset.method,
          body,
          busyLabel: 'Saving…',
        });
        if (!reply) return;
        Nx.flash(reply.message);
        go(form.dataset.done);
      },
      {signal},
    );
  });
})();
