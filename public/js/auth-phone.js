// The sign-in card's E-mail / Phone number tabs, and signing in or up with a code to your phone:
// number → 6-digit code → (new numbers only) name and email. The server checks everything again.
(function () {
  'use strict';

  const page = document.querySelector('[data-auth]');
  if (!page) return;
  const reduced = () =>
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- E-mail / Phone number tabs ----------
  const tabList = page.querySelector('[data-method-tabs]');
  const tabs = tabList
    ? [...tabList.querySelectorAll('[data-method-tab]')]
    : [];
  const panes = [...page.querySelectorAll('[data-method-pane]')];

  function showMethod(method, {focus = false} = {}) {
    if (!tabList) return;
    tabList.dataset.method = method;
    tabs.forEach((tab) => {
      const on = tab.dataset.methodTab === method;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
    });
    panes.forEach((pane) => {
      pane.hidden = pane.dataset.methodPane !== method;
    });
    const url = new URL(window.location.href);
    if (method === 'phone') url.searchParams.set('method', 'phone');
    else url.searchParams.delete('method');
    window.history.replaceState(
      window.history.state,
      '',
      url.pathname + url.search,
    );
    if (focus) {
      const pane = panes.find((p) => p.dataset.methodPane === method);
      const input =
        pane &&
        pane.querySelector('form:not([hidden]) input:not([type=hidden])');
      if (input) input.focus({preventScroll: true});
    }
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () =>
      showMethod(tab.dataset.methodTab, {focus: true}),
    );
    // Arrow keys move between the tabs (the ARIA tabs pattern).
    tab.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key))
        return;
      event.preventDefault();
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? tabs.length - 1
            : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) %
              tabs.length;
      tabs[next].focus();
      showMethod(tabs[next].dataset.methodTab);
    });
  });

  // "Phone" on the create-account side: flip to sign in, open the phone tab.
  page.querySelectorAll('[data-to-phone]').forEach((link) => {
    link.addEventListener('click', (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey) return;
      const toLogin = page.querySelector('[data-auth-to="login"]');
      if (!toLogin || !tabList) return;
      event.preventDefault();
      showMethod('phone');
      toLogin.click();
      setTimeout(() => showMethod('phone', {focus: true}), reduced() ? 0 : 440);
    });
  });

  // ---------- Phone code: three steps ----------
  const box = page.querySelector('[data-phone]');
  if (!box) return;
  const steps = {
    number: box.querySelector('[data-phone-step="number"]'),
    code: box.querySelector('[data-phone-step="code"]'),
    profile: box.querySelector('[data-phone-step="profile"]'),
  };
  const next = box.dataset.next || '/';
  let phone = '';
  let ticket = '';
  let timer = 0;

  const tenDigits = (value) => {
    let digits = String(value || '').replace(/\D/g, '');
    if (digits.length === 12 && digits.startsWith('91'))
      digits = digits.slice(2);
    if (digits.length === 11 && digits.startsWith('0'))
      digits = digits.slice(1);
    return digits;
  };
  const validPhone = (value) => /^[6-9]\d{9}$/.test(tenDigits(value));
  const pretty = (ten) => `+91 ${ten.slice(0, 5)} ${ten.slice(5)}`;

  function goTo(name) {
    Object.entries(steps).forEach(([key, form]) => {
      form.hidden = key !== name;
    });
    const form = steps[name];
    form.classList.remove('is-entering');
    void form.offsetWidth;
    form.classList.add('is-entering');
    const input = form.querySelector('input:not([type=hidden])');
    if (input) input.focus({preventScroll: true});
  }

  function setButton(form, state) {
    const submit = form.querySelector('[data-submit]');
    submit.dataset.state = state;
    submit.disabled = state === 'loading' || state === 'done';
    submit.setAttribute('aria-busy', String(state === 'loading'));
  }

  function fieldError(form, name, message) {
    const slot = form.querySelector(`[data-error-for="${name}"]`);
    const input = form.elements[name];
    if (slot) slot.textContent = message || '';
    if (input) {
      if (message) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    }
    const field = input && input.closest('[data-field], [data-otp]');
    if (field && message && !reduced()) {
      field.classList.remove('is-shaking');
      void field.offsetWidth;
      field.classList.add('is-shaking');
    }
  }

  async function send(form, url, body) {
    Nx.clearErrors(form);
    Nx.formAlert(form, '');
    setButton(form, 'loading');
    try {
      return await Nx.api(url, {method: 'POST', body});
    } catch (error) {
      setButton(form, 'idle');
      Nx.showErrors(form, error.fieldErrors);
      Nx.formAlert(
        form,
        error.status === 429
          ? error.message || 'Too many tries. Please wait a few minutes.'
          : error.message,
      );
      return null;
    }
  }

  // Resend: counts down 30 seconds, then the link wakes up.
  function startResendTimer() {
    const button = steps.code.querySelector('[data-resend]');
    const waitText = button.querySelector('[data-resend-wait]');
    const count = button.querySelector('[data-resend-count]');
    let left = 30;
    clearInterval(timer);
    button.disabled = true;
    waitText.hidden = false;
    count.textContent = String(left);
    timer = setInterval(() => {
      left -= 1;
      count.textContent = String(left);
      if (left <= 0) {
        clearInterval(timer);
        button.disabled = false;
        waitText.hidden = true;
      }
    }, 1000);
  }

  // Step 1: the number. Digits only, shown as "98765 43210".
  const numberInput = steps.number.elements.phone;
  numberInput.addEventListener('input', () => {
    const digits = numberInput.value.replace(/\D/g, '').slice(0, 12);
    const ten = digits.length > 10 ? tenDigits(digits) : digits;
    numberInput.value =
      ten.length > 5 ? `${ten.slice(0, 5)} ${ten.slice(5, 10)}` : ten;
    const field = numberInput.closest('[data-field]');
    field.classList.toggle('is-valid', validPhone(ten));
    if (validPhone(ten)) fieldError(steps.number, 'phone', '');
  });

  async function requestCode(form) {
    const result = await send(form, '/api/auth/phone/request', {phone});
    if (!result) return false;
    return true;
  }

  steps.number.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (steps.number.querySelector('[data-submit]').disabled) return;
    if (!validPhone(numberInput.value)) {
      fieldError(
        steps.number,
        'phone',
        'Enter a 10-digit Indian mobile number.',
      );
      numberInput.focus();
      return;
    }
    phone = tenDigits(numberInput.value);
    if (!(await requestCode(steps.number))) return;
    setButton(steps.number, 'idle');
    box.querySelectorAll('[data-phone-show]').forEach((el) => {
      el.textContent = pretty(phone);
    });
    steps.code.elements.code.value = '';
    paintBoxes();
    goTo('code');
    startResendTimer();
  });

  // Step 2: the code, drawn as six boxes.
  const codeInput = steps.code.elements.code;
  const boxes = [...steps.code.querySelectorAll('.au-otp-boxes span')];
  function paintBoxes() {
    const value = codeInput.value;
    const focused = document.activeElement === codeInput;
    boxes.forEach((slot, i) => {
      slot.textContent = value[i] || '';
      slot.classList.toggle('is-filled', Boolean(value[i]));
      slot.classList.toggle(
        'is-active',
        focused && i === Math.min(value.length, boxes.length - 1),
      );
    });
  }
  codeInput.addEventListener('input', () => {
    codeInput.value = codeInput.value.replace(/\D/g, '').slice(0, 6);
    fieldError(steps.code, 'code', '');
    paintBoxes();
    if (codeInput.value.length === 6)
      setTimeout(() => steps.code.requestSubmit(), 150);
  });
  ['focus', 'blur', 'keyup', 'click'].forEach((type) =>
    codeInput.addEventListener(type, paintBoxes),
  );

  steps.code.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (steps.code.querySelector('[data-submit]').disabled) return;
    if (!/^\d{6}$/.test(codeInput.value)) {
      fieldError(
        steps.code,
        'code',
        'Enter the 6-digit code from the text message.',
      );
      codeInput.focus();
      return;
    }
    const result = await send(steps.code, '/api/auth/phone/verify', {
      phone,
      code: codeInput.value,
    });
    if (!result) {
      codeInput.select();
      paintBoxes();
      return;
    }
    if (result.needsProfile) {
      ticket = result.ticket;
      clearInterval(timer);
      setButton(steps.code, 'idle');
      goTo('profile');
      return;
    }
    finish(steps.code, result);
  });

  steps.code
    .querySelector('[data-resend]')
    .addEventListener('click', async () => {
      const button = steps.code.querySelector('[data-resend]');
      button.disabled = true;
      try {
        await Nx.api('/api/auth/phone/request', {
          method: 'POST',
          body: {phone},
        });
        Nx.formAlert(steps.code, 'A new code is on its way.', 'success');
        codeInput.value = '';
        paintBoxes();
        codeInput.focus();
        startResendTimer();
      } catch (error) {
        Nx.formAlert(steps.code, error.message);
        button.disabled = false;
      }
    });

  steps.code
    .querySelector('[data-phone-change]')
    .addEventListener('click', () => {
      clearInterval(timer);
      setButton(steps.number, 'idle');
      goTo('number');
      numberInput.select();
    });

  // Step 3: name and email for a new number.
  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const NAME = /^\p{L}[\p{L} .'-]*$/u;
  steps.profile.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (steps.profile.querySelector('[data-submit]').disabled) return;
    const name = steps.profile.elements.name.value.trim().replace(/\s+/g, ' ');
    const email = steps.profile.elements.email.value.trim();
    const nameProblem =
      name.length < 2
        ? 'Enter your name (at least 2 letters).'
        : NAME.test(name)
          ? ''
          : 'Use letters, spaces, dots, apostrophes or hyphens only.';
    const emailProblem = EMAIL.test(email)
      ? ''
      : 'Enter a valid email address.';
    fieldError(steps.profile, 'name', nameProblem);
    fieldError(steps.profile, 'email', emailProblem);
    if (nameProblem || emailProblem) {
      steps.profile.elements[nameProblem ? 'name' : 'email'].focus();
      return;
    }
    const result = await send(steps.profile, '/api/auth/phone/signup', {
      ticket,
      name,
      email,
    });
    if (result) finish(steps.profile, result);
  });

  // Signed in: tick, then into the store. replace, so Back does not return to the form.
  function finish(form, result) {
    setButton(form, 'done');
    Nx.formAlert(form, result.message, 'success');
    setTimeout(() => window.location.replace(next), reduced() ? 100 : 450);
  }
})();
