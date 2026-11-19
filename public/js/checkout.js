// Checkout: three steps (address, summary, payment) on one page, plus the coupon box and the
// wallet. The server works out every price, the coupon discount and every total; this page only
// sends the address, the payment method, the coupon code and whether to use the wallet, then
// shows the totals the server sends back.
(function () {
  'use strict';

  const page = document.querySelector('[data-checkout]');
  if (!page) return;
  // "cart" buys the whole cart; "buynow" buys only the Buy now product and leaves the cart alone.
  // The server is told on every call, so both checkouts share all the code below.
  const source = page.dataset.source === 'buynow' ? 'buynow' : 'cart';
  const isBuyNow = source === 'buynow';
  const steps = [...page.querySelectorAll('[data-step]')];
  const stepper = [...page.querySelectorAll('[data-stepper]')];

  let currentStep = 1;
  function open(number) {
    currentStep = number;
    steps.forEach((step) => {
      const n = Number(step.dataset.step);
      const body = step.querySelector('.step-body');
      const edit = step.querySelector('[data-step-edit]');
      step.classList.toggle('is-open', n === number);
      step.classList.toggle('is-done', n < number);
      body.hidden = n !== number;
      if (n === number) {
        // The step slides in (motion.css); restarting the class replays it.
        body.classList.remove('step-enter');
        void body.offsetWidth;
        body.classList.add('step-enter');
      }
      if (edit) edit.hidden = n >= number;
    });
    // The bar under the steps fills up; on phones the Pay button sticks to the bottom on step 3.
    const bar = page.querySelector('.stepper');
    if (bar)
      bar.style.setProperty(
        '--progress',
        String((number - 1) / (steps.length - 1)),
      );
    page.classList.toggle('is-paying', number === steps.length);
    stepper.forEach((item) => {
      if (Number(item.dataset.stepper) === number)
        item.setAttribute('aria-current', 'step');
      else item.removeAttribute('aria-current');
      item.classList.toggle('is-done', Number(item.dataset.stepper) < number);
    });
    const current = steps[number - 1];
    const heading = current.querySelector('h2');
    heading.setAttribute('tabindex', '-1');
    heading.focus();
    syncBar();
  }

  // ---------- Phones: the pay bar and the price details sheet (C3) ----------
  // The bar's button does this step's main action, so it is always under the thumb. On step 3 it
  // shows the Pay button's own words and is disabled exactly when that button is.
  const bar = page.querySelector('[data-pay-bar]');
  const barGo = bar && bar.querySelector('[data-pay-bar-go]');
  const sheet = page.querySelector('[data-summary-sheet]');
  const scrim = page.querySelector('[data-summary-scrim]');
  const openSheetButton = page.querySelector('[data-summary-open]');
  const phone = window.matchMedia('(max-width: 720px)');

  function stepAction(number) {
    if (number < steps.length)
      return page.querySelector(`[data-step-next="${number}"]`);
    return page.querySelector('[data-place-order] [type="submit"]');
  }
  function syncBar() {
    if (!barGo) return;
    const action = stepAction(currentStep);
    if (!action) return;
    barGo.disabled = action.disabled;
    const words =
      currentStep === steps.length
        ? (page.querySelector('[data-place-text]') || action).textContent
        : action.textContent;
    barGo.textContent = words.trim();
  }
  if (barGo) {
    barGo.addEventListener('click', () => {
      const action = stepAction(currentStep);
      if (!action || action.disabled) return;
      if (currentStep === steps.length) action.form.requestSubmit(action);
      else action.click();
    });
  }

  let sheetOpener = null;
  function setSheet(on) {
    if (!sheet) return;
    const isPhone = phone.matches;
    sheet.classList.toggle('is-open', on && isPhone);
    if (scrim) scrim.hidden = !(on && isPhone);
    openSheetButton.setAttribute('aria-expanded', String(on && isPhone));
    if (on && isPhone) {
      sheet.setAttribute('role', 'dialog');
      sheet.setAttribute('aria-modal', 'true');
      // Focus goes back to the Details button when the sheet closes (it is the only way to open it).
      sheetOpener = openSheetButton;
      document.documentElement.classList.add('has-sheet');
      const close = sheet.querySelector('[data-summary-close]');
      if (close) close.focus();
    } else {
      sheet.removeAttribute('role');
      sheet.removeAttribute('aria-modal');
      document.documentElement.classList.remove('has-sheet');
      if (sheetOpener && document.contains(sheetOpener)) sheetOpener.focus();
      sheetOpener = null;
    }
  }
  if (openSheetButton)
    openSheetButton.addEventListener('click', () =>
      setSheet(!sheet.classList.contains('is-open')),
    );
  page
    .querySelectorAll('[data-summary-close]')
    .forEach((button) =>
      button.addEventListener('click', () => setSheet(false)),
    );
  if (scrim) scrim.addEventListener('click', () => setSheet(false));
  document.addEventListener('keydown', (event) => {
    if (
      event.key !== 'Escape' ||
      !sheet ||
      !sheet.classList.contains('is-open')
    )
      return;
    setSheet(false);
  });
  // Keep Tab inside the open sheet, as a dialog does.
  if (sheet) {
    sheet.addEventListener('keydown', (event) => {
      if (event.key !== 'Tab' || !sheet.classList.contains('is-open')) return;
      const items = [
        ...sheet.querySelectorAll('button, a[href], input, select, textarea'),
      ].filter((el) => !el.disabled && el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
  }
  // Turning the phone sideways (or a wider window) closes the sheet: the sidebar is back.
  phone.addEventListener('change', () => setSheet(false));

  const chosenAddress = () =>
    page.querySelector('input[name="addressId"]:checked');
  const deliveryNote = page.querySelector('[data-checkout-delivery]');

  // The arrival date for the chosen address (C3). The server puts it on each address card (data-eta);
  // an address added just now has none yet, so it is asked for.
  const payEta = page.querySelector('[data-pay-eta]');
  async function etaFor(address) {
    if (!address) return {label: '', off: ''};
    if (address.dataset.eta || address.dataset.etaOff)
      return {label: address.dataset.eta, off: address.dataset.etaOff};
    try {
      const {estimate} = await Nx.api(
        `/api/delivery/estimate?pincode=${encodeURIComponent(address.dataset.pincode)}`,
      );
      return estimate.deliverable
        ? {label: estimate.label, off: ''}
        : {label: '', off: estimate.reason};
    } catch {
      return {label: '', off: ''};
    }
  }
  async function showDelivery(address) {
    const {label, off} = await etaFor(address);
    if (deliveryNote) {
      deliveryNote.className = off
        ? 'delivery-result is-error'
        : label
          ? 'delivery-result is-ok'
          : 'delivery-result';
      deliveryNote.textContent = off || (label ? `Arrives ${label}` : '');
    }
    if (payEta) {
      payEta.hidden = !label;
      payEta.querySelector('[data-pay-eta-text]').textContent = label;
    }
  }
  page.addEventListener('change', (event) => {
    if (event.target.name === 'addressId') showDelivery(event.target);
  });

  page.querySelectorAll('[data-step-next]').forEach((button) => {
    button.addEventListener('click', () => {
      const from = Number(button.dataset.stepNext);
      if (from === 1) {
        const address = chosenAddress();
        const error = page.querySelector('[data-error-for="addressId"]');
        if (!address) {
          error.textContent = 'Choose a delivery address.';
          return;
        }
        error.textContent = '';
        steps[0].querySelector('[data-step-summary]').textContent =
          address.dataset.label;
        showDelivery(address);
      }
      if (from === 2) {
        const count = page.querySelectorAll('.checkout-items li').length;
        steps[1].querySelector('[data-step-summary]').textContent =
          `${count} ${count === 1 ? 'item' : 'items'}`;
      }
      open(from + 1);
    });
  });
  page.querySelectorAll('[data-step-edit]').forEach((button) => {
    button.addEventListener('click', () =>
      open(Number(button.dataset.stepEdit)),
    );
  });

  // ---------- Totals from the server ----------
  const form = page.querySelector('[data-place-order]');
  const placeButton = form.querySelector('[type="submit"]');

  // A gift for someone else: show the fields, and send them with the order.
  const giftToggle = form.querySelector('[data-gift-toggle]');
  const giftFields = form.querySelector('[data-gift-fields]');
  if (giftToggle && giftFields)
    giftToggle.addEventListener('change', () => {
      giftFields.hidden = !giftToggle.checked;
    });
  const giftRecipient = () =>
    giftToggle && giftToggle.checked
      ? {
          name: form.elements.giftName.value.trim(),
          email: form.elements.giftEmail.value.trim(),
          message: form.elements.giftMessage.value.trim(),
        }
      : null;
  const summary = page.querySelector('[data-summary]');
  const cards = [...form.querySelectorAll('[data-pay-card]')];
  const methodInput = (name) =>
    form.querySelector(`[data-pay-card="${name}"] input[name="paymentMethod"]`);
  const restBox = form.querySelector('[data-pay-rest]');
  const walletNote = form.querySelector('[data-wallet-note]');
  const codNote = form.querySelector('[data-cod-note]');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let current = null; // the latest quote from the server
  let processing = false;

  // Money counts to its new value. Only the text changes, so nothing on the page moves.
  function countTo(el, paise, prefix) {
    const from = Number(el.dataset.value);
    el.dataset.value = String(paise);
    if (!Number.isFinite(from) || from === paise || reducedMotion.matches) {
      el.textContent = prefix + Nx.formatPrice(paise);
      return;
    }
    // Whole rupees while it counts, the exact amount at the end.
    Nx.countUp(el, paise, {
      from,
      format: (value) =>
        prefix +
        Nx.formatPrice(value === paise ? paise : Math.round(value / 100) * 100),
    });
  }

  function setMoney(name, paise) {
    page.querySelectorAll(`[data-sum="${name}"]`).forEach((el) => {
      if (el.hasAttribute('data-free') && !paise) {
        el.dataset.value = '0';
        el.innerHTML = '<span class="text-success">Free</span>';
      } else {
        countTo(el, paise, el.hasAttribute('data-minus') ? '−' : '');
      }
    });
  }

  const chosenMethod = () =>
    (form.querySelector('input[name="paymentMethod"]:checked') || {}).value ||
    '';
  const restMethod = () =>
    (form.querySelector('input[name="restMethod"]:checked') || {}).value || '';
  const usingWallet = () => chosenMethod() === 'wallet';

  // The selected card opens to show its details; the others close.
  function syncCards(animate = true) {
    cards.forEach((card) => {
      const on = card.querySelector('input[name="paymentMethod"]').checked;
      card.classList.toggle('is-selected', on);
      const details = card.querySelector('[data-pay-details]');
      if (details.hidden !== on) return;
      details.hidden = !on;
      if (on && animate) {
        details.classList.remove('is-entering');
        void details.offsetWidth;
        details.classList.add('is-entering');
      }
    });
  }

  // What pressing the button will do, from the chosen card (and how to pay the rest).
  const online = (kind) => ({kind});
  function plan() {
    const method = chosenMethod();
    if (method !== 'wallet') return {...online(method), useWallet: false};
    if (current && current.coveredByWallet)
      return {kind: 'wallet', useWallet: true};
    return {...online(restMethod()), useWallet: true};
  }

  function updatePlaceText() {
    // Looked up each time: the busy spinner swaps the button's contents and puts them back.
    const placeText = form.querySelector('[data-place-text]');
    const p = plan();
    const t = current && current.totals;
    const amount = t
      ? Nx.formatPrice(p.kind === 'wallet' ? t.walletUsed : t.total)
      : '';
    placeText.textContent =
      p.kind === 'razorpay'
        ? `Pay ${amount} securely`
        : p.kind === 'wallet'
          ? `Pay ${amount} from wallet`
          : p.kind === 'cod'
            ? `Place order · ${amount} on delivery`
            : 'Choose how to pay';
  }

  function updateButton() {
    const p = plan();
    placeButton.disabled =
      processing || !current || current.problems.length > 0 || !p.kind;
    updatePlaceText();
    syncBar();
  }

  function render(quote) {
    current = quote;
    const t = quote.totals;
    [
      'mrpTotal',
      'discount',
      'couponDiscount',
      'prepaidDiscount',
      'deliveryFee',
      'walletUsed',
      'total',
    ].forEach((name) => setMoney(name, t[name] || 0));
    setMoney(
      'savings',
      t.discount + t.couponDiscount + (t.prepaidDiscount || 0),
    );
    page.querySelectorAll('[data-sum-text="couponCode"]').forEach((el) => {
      el.textContent = t.couponCode;
    });
    page.querySelector('[data-sum-row="couponDiscount"]').hidden =
      !t.couponDiscount;
    page.querySelector('[data-sum-row="walletUsed"]').hidden = !t.walletUsed;
    const prepaidRow = page.querySelector('[data-sum-row="prepaidDiscount"]');
    if (prepaidRow) prepaidRow.hidden = !t.prepaidDiscount;
    page.querySelector('[data-saving]').hidden = !(
      t.discount + t.couponDiscount + (t.prepaidDiscount || 0) >
      0
    );
    // E2: what paying online saves, on the online cards (changes with the coupon and the cart).
    const offer = quote.onlineOffer;
    form.querySelectorAll('[data-online-offer]').forEach((note) => {
      note.hidden = !(offer && offer.saving > 0);
      const amount = note.querySelector('[data-online-saving]');
      if (amount && offer)
        amount.textContent = `${Nx.formatPrice(offer.saving)} off`;
    });

    // Cash on Delivery depends on the amount left to pay.
    if (!usingWallet()) {
      const cod = methodInput('cod');
      cod.disabled = !quote.codAllowed;
      cod
        .closest('[data-pay-card]')
        .classList.toggle('is-disabled', !quote.codAllowed);
      codNote.textContent = quote.codAllowed
        ? codNote.dataset.ok
        : codNote.dataset.off;
      if (cod.checked && cod.disabled) {
        cod.checked = false;
        const online = methodInput('razorpay');
        if (!online.disabled) online.checked = true;
      }
    } else if (restBox) {
      restBox.hidden = quote.coveredByWallet;
      const restCod = restBox.querySelector('input[value="cod"]');
      const restOnline = restBox.querySelector('input[value="razorpay"]');
      restCod.disabled = !quote.codAllowed;
      if (restCod.checked && restCod.disabled) {
        restCod.checked = false;
        if (!restOnline.disabled) restOnline.checked = true;
      }
      walletNote.textContent = quote.coveredByWallet
        ? `Your wallet covers this whole order. ${Nx.formatPrice(quote.walletBalance - t.walletUsed)} stays in your wallet.`
        : `${Nx.formatPrice(t.walletUsed)} comes from your wallet.`;
    }
    syncCards();
    updateButton();
    renderCoupon(quote);
  }

  let refreshing = 0;
  async function refresh() {
    const ticket = ++refreshing;
    summary.classList.add('is-updating');
    placeButton.disabled = true;
    try {
      // payOnline: the rest is paid online, which may take the online-payment discount off (E2).
      const {quote} = await Nx.api('/api/checkout/quote', {
        method: 'POST',
        body: {
          useWallet: usingWallet(),
          source,
          payOnline: plan().kind === 'razorpay',
        },
      });
      if (ticket === refreshing) render(quote);
    } catch (error) {
      Nx.toast(error.message, 'error');
      updateButton();
    } finally {
      if (ticket === refreshing) summary.classList.remove('is-updating');
    }
  }

  form.addEventListener('change', (event) => {
    if (event.target.name === 'paymentMethod') {
      Nx.clearErrors(form);
      syncCards();
      refresh();
    }
    if (event.target.name === 'restMethod') refresh();
  });
  syncCards(false);
  refresh();

  // ---------- Coupons ----------
  const couponBox = page.querySelector('[data-coupon]');
  const couponForm = couponBox.querySelector('[data-coupon-form]');
  const applied = couponBox.querySelector('[data-coupon-applied]');
  const notice = couponBox.querySelector('[data-coupon-notice]');

  function renderCoupon(quote) {
    applied.hidden = !quote.coupon;
    couponForm.hidden = Boolean(quote.coupon);
    if (quote.coupon) {
      const codeEl = applied.querySelector('[data-coupon-code]');
      const fresh = codeEl.textContent !== quote.coupon.code;
      codeEl.textContent = quote.coupon.code;
      // A new coupon: its saving counts up from ₹0, so the shopper sees what it is worth.
      const saving = applied.querySelector('[data-coupon-saving]');
      Nx.countUp(saving, quote.coupon.saving, {
        from: fresh ? 0 : quote.coupon.saving,
        format: (value) => `You save ${Nx.formatPrice(Math.round(value))}`,
      });
    }
    notice.hidden = !quote.couponNotice;
    notice.querySelector('span').textContent = quote.couponNotice || '';
  }

  async function applyCoupon(code, button) {
    Nx.clearErrors(couponForm);
    Nx.busy(button, true, 'Applying…');
    try {
      const reply = await Nx.api('/api/checkout/coupon', {
        method: 'POST',
        body: {code, source},
      });
      Nx.toast(reply.message);
      couponForm.reset();
      await refresh();
      applied.classList.remove('is-popped');
      void applied.offsetWidth;
      applied.classList.add('is-popped');
    } catch (error) {
      Nx.showErrors(
        couponForm,
        error.fieldErrors && error.fieldErrors.code
          ? error.fieldErrors
          : {code: error.message},
      );
      if (couponForm.hidden) Nx.toast(error.message, 'error');
    } finally {
      Nx.busy(button, false);
    }
  }

  couponForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const code = couponForm.elements.code.value
      .replace(/\s+/g, '')
      .toUpperCase();
    if (!/^[A-Z0-9]{3,20}$/.test(code)) {
      Nx.clearErrors(couponForm);
      Nx.showErrors(couponForm, {code: 'Enter a valid coupon code.'});
      couponForm.elements.code.focus();
      return;
    }
    applyCoupon(code, couponForm.querySelector('[type="submit"]'));
  });

  couponBox
    .querySelector('[data-coupon-remove]')
    .addEventListener('click', async (event) => {
      const button = event.currentTarget;
      Nx.busy(button, true, 'Removing…');
      try {
        const reply = await Nx.api(`/api/checkout/coupon?source=${source}`, {
          method: 'DELETE',
        });
        Nx.toast(reply.message);
        await refresh();
        couponForm.elements.code.focus();
      } catch (error) {
        Nx.toast(error.message, 'error');
      } finally {
        Nx.busy(button, false);
      }
    });

  // ---------- When placing the order fails: say why, and offer the fix (C3) ----------
  // The server tags each failure with a code (error.code). The message box above the Pay button shows
  // the message and one or two buttons that do the fix, instead of a toast that disappears.
  const alertBox = form.querySelector('[data-form-alert]');
  const backLink = page.querySelector('.breadcrumb a:last-of-type');
  function switchTo(method) {
    const input = methodInput(method);
    if (!input || input.disabled) return false;
    input.checked = true;
    input.dispatchEvent(new Event('change', {bubbles: true}));
    input.focus();
    return true;
  }
  const FIXES = {
    items_unavailable: () => [
      isBuyNow
        ? {
            label: 'Back to the product',
            href: backLink ? backLink.getAttribute('href') : '/products',
          }
        : {label: 'Review your cart', href: '/cart'},
    ],
    coupon_invalid: () => [
      {
        label: 'Remove the coupon',
        run: () => couponBox.querySelector('[data-coupon-remove]').click(),
      },
    ],
    cod_limit: () =>
      methodInput('razorpay') && !methodInput('razorpay').disabled
        ? [{label: 'Pay online instead', run: () => switchTo('razorpay')}]
        : [],
    cod_open_limit: () =>
      methodInput('razorpay') && !methodInput('razorpay').disabled
        ? [{label: 'Pay online instead', run: () => switchTo('razorpay')}]
        : [],
    wallet_short: () => [
      {
        label: 'Choose how to pay the rest',
        run: () => {
          const rest = form.querySelector(
            'input[name="restMethod"]:not(:disabled)',
          );
          if (rest) rest.focus();
        },
      },
    ],
    gateway: () => [
      {label: 'Try again', run: () => form.requestSubmit(placeButton)},
      ...(current && current.codAllowed && methodInput('cod')
        ? [{label: 'Pay on delivery instead', run: () => switchTo('cod')}]
        : []),
    ],
  };
  function showFailure(error) {
    Nx.showErrors(form, error.fieldErrors);
    const fixes = (FIXES[error.code] || (() => []))();
    if (!alertBox) {
      Nx.toast(error.message, 'error');
      return;
    }
    alertBox.replaceChildren();
    alertBox.className = 'form-alert form-alert-error checkout-fix';
    const text = document.createElement('p');
    text.textContent = error.message;
    alertBox.append(text);
    if (fixes.length) {
      const row = document.createElement('div');
      row.className = 'checkout-fix-actions';
      fixes.forEach((fix, index) => {
        const el = document.createElement(fix.href ? 'a' : 'button');
        el.className = `btn btn-sm ${index === 0 ? 'btn-primary' : 'btn-ghost'}`;
        el.textContent = fix.label;
        if (fix.href) el.href = fix.href;
        else {
          el.type = 'button';
          el.addEventListener('click', () => {
            alertBox.replaceChildren();
            alertBox.className = 'form-alert';
            fix.run();
          });
        }
        row.append(el);
      });
      alertBox.append(row);
    }
    alertBox.scrollIntoView({
      block: 'center',
      behavior: reducedMotion.matches ? 'auto' : 'smooth',
    });
  }
  async function send(url, body, busyLabel) {
    Nx.clearErrors(form);
    if (alertBox) {
      alertBox.replaceChildren();
      alertBox.className = 'form-alert';
    }
    Nx.busy(placeButton, true, busyLabel);
    try {
      return await Nx.api(url, {method: 'POST', body});
    } catch (error) {
      showFailure(error);
      return null;
    } finally {
      Nx.busy(placeButton, false);
    }
  }

  // ---------- Place the order ----------
  // After a failed or cancelled online payment: cancel that unpaid order (any wallet amount and
  // coupon use come straight back), then let the shopper pick again. The cart was never touched.
  async function chooseOther(orderId) {
    processing = false;
    if (orderId) {
      try {
        await Nx.api(`/api/orders/${encodeURIComponent(orderId)}/cancel`, {
          method: 'POST',
          body: {reason: ''},
        });
      } catch {
        // It stays in Your orders with a Retry button; nothing is lost.
      }
    }
    await refresh();
    Nx.toast('Choose another way to pay. Your cart is just as you left it.');
  }

  // ---------- Cash on Delivery code (E2) ----------
  // When the store asks for it, the server answers cod_code_needed: a code goes to the delivery phone and
  // this dialog takes it, then the same order is sent again with the code. Resolves with the reply or null.
  const codDialog = document.getElementById('cod-code-dialog');
  async function askCode(addressId) {
    const reply = await Nx.api('/api/checkout/cod-code', {
      method: 'POST',
      body: {addressId},
    }).catch((error) => {
      showFailure(error);
      return null;
    });
    if (!reply) return false;
    codDialog.querySelector('[data-cod-code-sent]').textContent = reply.message;
    return true;
  }
  function placeWithCode(body) {
    return new Promise((resolve) => {
      (async () => {
        try {
          Nx.clearErrors(form);
          Nx.busy(placeButton, true, 'Placing your order…');
          resolve(await Nx.api('/api/orders', {method: 'POST', body}));
        } catch (error) {
          if (error.code !== 'cod_code_needed' || !codDialog) {
            showFailure(error);
            resolve(null);
            return;
          }
          if (!(await askCode(body.addressId))) {
            resolve(null);
            return;
          }
          const codeForm = codDialog.querySelector('[data-cod-code-form]');
          const input = codeForm.elements.codCode;
          input.value = '';
          Nx.clearErrors(codeForm);
          codDialog.showModal();
          input.focus();
          const resend = codeForm.querySelector('[data-cod-code-resend]');
          const onResend = async () => {
            Nx.busy(resend, true, 'Sending…');
            if (await askCode(body.addressId))
              Nx.toast('A new code is on its way.');
            Nx.busy(resend, false);
          };
          const onSubmit = async (event) => {
            event.preventDefault();
            if (!/^[0-9]{6}$/.test(input.value)) {
              Nx.showErrors(codeForm, {
                codCode: 'Enter the 6 digits from the message.',
              });
              return;
            }
            const confirm = codeForm.querySelector('[data-cod-code-confirm]');
            Nx.busy(confirm, true, 'Checking…');
            try {
              const reply = await Nx.api('/api/orders', {
                method: 'POST',
                body: {...body, codCode: input.value},
              });
              done();
              codDialog.close();
              resolve(reply);
            } catch (failure) {
              if (/^cod_code_/.test(failure.code || ''))
                Nx.showErrors(
                  codeForm,
                  failure.fieldErrors || {codCode: failure.message},
                );
              else {
                done();
                codDialog.close();
                showFailure(failure);
                resolve(null);
              }
            } finally {
              Nx.busy(confirm, false);
            }
          };
          const onClose = () => {
            done();
            resolve(null);
          };
          function done() {
            codeForm.removeEventListener('submit', onSubmit);
            resend.removeEventListener('click', onResend);
            codDialog.removeEventListener('close', onClose);
          }
          codeForm.addEventListener('submit', onSubmit);
          resend.addEventListener('click', onResend);
          codDialog.addEventListener('close', onClose);
        } finally {
          Nx.busy(placeButton, false);
        }
      })();
    });
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (processing || placeButton.disabled) return;
    const address = chosenAddress();
    if (!address) {
      open(1);
      return;
    }
    const p = plan();
    if (!p.kind) {
      Nx.showErrors(form, {paymentMethod: 'Choose how to pay.'});
      return;
    }
    processing = true;
    // Online payment: the server saves the order unpaid and creates a Razorpay order for the
    // amount it worked out; then Razorpay's secure window takes the payment.
    if (p.kind === 'razorpay') {
      const checkout = await send(
        '/api/payments/razorpay/order',
        {addressId: address.value, useWallet: p.useWallet, source},
        'Preparing secure payment…',
      );
      if (checkout && Nx.payOnline) {
        placeButton.disabled = true;
        // Razorpay asks for a phone unless one is given: use the chosen address's, so the shopper types nothing twice.
        const prefill = Nx.prefillFrom(page);
        if (address.dataset.phone) prefill.contact = address.dataset.phone;
        Nx.payOnline(checkout, prefill, {
          onChooseOther: chooseOther,
          keepCart: isBuyNow,
        });
      } else {
        processing = false;
        refresh();
      }
      return;
    }
    const reply = await placeWithCode({
      addressId: address.value,
      paymentMethod: p.kind,
      useWallet: p.useWallet,
      source,
      giftRecipient: giftRecipient(),
    });
    if (!reply) {
      // Prices, stock or the wallet may have changed: show the latest totals.
      processing = false;
      refresh();
      return;
    }
    placeButton.disabled = true;
    // A Buy now order leaves the cart as it was.
    if (!isBuyNow) Nx.setCartCount(0);
    // replace, not assign: Back must never come back here and place the order again.
    window.location.replace(reply.redirect);
  });
})();
