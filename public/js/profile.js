// Profile page: account details, password change, and the address book.
(function () {
  'use strict';

  function reloadWith(message) {
    Nx.flash(message);
    window.location.reload();
  }

  // ---------- Account details ----------
  const profileForm = document.querySelector('[data-profile-form]');
  if (profileForm) {
    profileForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const result = await Nx.submitForm(profileForm, {
        url: '/api/profile',
        method: 'PATCH',
        busyLabel: 'Saving…',
      });
      if (result) reloadWith(result.message);
    });
  }

  // ---------- Password ----------
  const passwordForm = document.querySelector('[data-password-form]');
  if (passwordForm) {
    passwordForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const values = Nx.formValues(passwordForm);
      if (values.newPassword !== values.confirmPassword) {
        Nx.clearErrors(passwordForm);
        Nx.showErrors(passwordForm, {
          confirmPassword: 'Passwords do not match.',
        });
        return;
      }
      const result = await Nx.submitForm(passwordForm, {
        url: '/api/profile/password',
        method: 'PATCH',
        body: values,
        busyLabel: 'Updating…',
      });
      if (result) {
        passwordForm.reset();
        passwordForm
          .querySelectorAll('[data-rules] .is-met')
          .forEach((item) => item.classList.remove('is-met'));
        const bar = passwordForm.querySelector('[data-strength-bar]');
        if (bar) bar.dataset.score = '0';
        Nx.formAlert(passwordForm, result.message, 'success');
        Nx.toast(result.message);
      }
    });
  }

  // ---------- Section menu ----------
  // Highlights the section currently on screen in the side menu.
  const navLinks = [
    ...document.querySelectorAll("[data-account-nav] a[href^='#']"),
  ];
  if (navLinks.length && 'IntersectionObserver' in window) {
    const mark = (id) =>
      navLinks.forEach((link) => {
        const on = link.getAttribute('href') === `#${id}`;
        link.classList.toggle('is-active', on);
        if (on) link.setAttribute('aria-current', 'true');
        else link.removeAttribute('aria-current');
      });
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) mark(entry.target.id);
        });
      },
      {rootMargin: '-30% 0px -60% 0px'},
    );
    navLinks.forEach((link) => {
      const section = document.querySelector(link.getAttribute('href'));
      if (section) observer.observe(section);
    });
    mark((location.hash || navLinks[0].getAttribute('href')).slice(1));
  }

  // ---------- Address book ----------
  // The address just saved (C2): its card scrolls into view with a tick that draws itself and a short
  // glow. On checkout it is also chosen, so the shopper can carry straight on. With reduced motion the
  // tick is simply there.
  const SAVED_KEY = 'nx:address-saved';
  (function markSavedAddress() {
    let savedId;
    try {
      savedId = sessionStorage.getItem(SAVED_KEY);
      sessionStorage.removeItem(SAVED_KEY);
    } catch {
      return;
    }
    if (!savedId) return;
    const radio = document.querySelector(
      `input[name="addressId"][value="${CSS.escape(savedId)}"]`,
    );
    if (radio) {
      radio.checked = true;
      radio.dispatchEvent(new Event('change', {bubbles: true}));
    }
    Nx.markSaved(
      radio
        ? radio.closest('.address-choice')
        : document.querySelector(`[data-address-id="${CSS.escape(savedId)}"]`),
    );
  })();
  const dialog = document.getElementById('address-dialog');
  const addressForm = document.querySelector('[data-address-form]');
  if (!dialog || !addressForm) return;
  const title = dialog.querySelector('#address-dialog-title');

  function openAddressDialog(address) {
    addressForm.reset();
    Nx.clearErrors(addressForm);
    addressForm.elements.id.value = address ? address.id : '';
    if (address) {
      for (const key of [
        'fullName',
        'phone',
        'line1',
        'line2',
        'landmark',
        'city',
        'state',
        'pincode',
      ]) {
        addressForm.elements[key].value = address[key] || '';
      }
      addressForm.elements.isDefault.checked = Boolean(address.isDefault);
      addressForm.elements.type.value = address.type || 'home';
    }
    title.textContent = address ? 'Edit address' : 'Add a new address';
    addressForm.querySelector('[type="submit"]').textContent = address
      ? 'Save changes'
      : 'Save address';
    dialog.showModal();
    addressForm.elements.fullName.focus();
  }

  document.querySelectorAll('[data-address-add]').forEach((button) => {
    button.addEventListener('click', () => openAddressDialog(null));
  });

  document.querySelectorAll('[data-address-edit]').forEach((button) => {
    button.addEventListener('click', () =>
      openAddressDialog(JSON.parse(button.dataset.address)),
    );
  });

  dialog.querySelectorAll('[data-dialog-close]').forEach((button) => {
    button.addEventListener('click', () => dialog.close());
  });

  // ---------- PIN code fills the town and state ----------
  // Six digits in, a lookup goes out; the town and state are filled only if they are empty or were filled
  // by an earlier lookup, so nothing the shopper typed is ever replaced. The hint says what happened.
  const pinInput = addressForm.querySelector('[data-pincode-lookup]');
  const pinStatus = addressForm.querySelector('[data-pincode-status]');
  const cityInput = addressForm.elements.city;
  const stateSelect = addressForm.elements.state;
  const pinHint = pinStatus ? pinStatus.textContent : '';
  let lastPin = '';
  let pinRequest = 0;
  const fillIfFree = (field, value) => {
    if (!value || (field.value && field.dataset.auto !== '1')) return false;
    field.value = value;
    field.dataset.auto = '1';
    field.classList.remove('is-filled');
    void field.offsetWidth;
    field.classList.add('is-filled');
    return true;
  };
  [cityInput, stateSelect].forEach((field) =>
    field.addEventListener('input', () => {
      delete field.dataset.auto;
    }),
  );

  async function lookUpPin() {
    const pin = pinInput.value;
    if (pin.length !== 6 || pin === lastPin) return;
    lastPin = pin;
    const request = ++pinRequest;
    pinStatus.textContent = 'Finding your town…';
    try {
      const {place} = await Nx.api(
        `/api/delivery/pincode/${encodeURIComponent(pin)}`,
      );
      if (request !== pinRequest) return;
      const gotCity = fillIfFree(cityInput, place.city);
      const gotState = fillIfFree(stateSelect, place.state);
      pinStatus.textContent =
        place.city && place.state
          ? `${place.city}, ${place.state}. Change them if they're not right.`
          : place.state
            ? `Filled in ${place.state}. Type your town or city.`
            : "We couldn't find this PIN code. Check the digits, or type your town and state.";
      if (!gotCity && !gotState && (place.city || place.state))
        pinStatus.textContent = `This PIN code is in ${[place.city, place.state].filter(Boolean).join(', ')}.`;
    } catch (error) {
      if (request === pinRequest)
        pinStatus.textContent =
          "Type your town and state: the PIN code lookup isn't answering right now.";
    }
  }
  if (pinInput && pinStatus) {
    pinInput.addEventListener('input', () => {
      // Digits only (a pasted "560 038" works too).
      const digits = pinInput.value.replace(/\D/g, '').slice(0, 6);
      if (digits !== pinInput.value) pinInput.value = digits;
      if (digits.length < 6) {
        lastPin = '';
        pinStatus.textContent = pinHint;
        return;
      }
      lookUpPin();
    });
    dialog.addEventListener('close', () => {
      lastPin = '';
      pinStatus.textContent = pinHint;
      delete cityInput.dataset.auto;
      delete stateSelect.dataset.auto;
    });
  }

  addressForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = Nx.formValues(addressForm);
    const id = values.id;
    delete values.id;
    const result = await Nx.submitForm(addressForm, {
      url: id ? `/api/addresses/${encodeURIComponent(id)}` : '/api/addresses',
      method: id ? 'PATCH' : 'POST',
      body: values,
      busyLabel: 'Saving…',
    });
    if (result) {
      // After the reload, this address gets the "just saved" tick (below), and checkout selects it.
      const savedId =
        (result.address && (result.address._id || result.address.id)) || id;
      try {
        sessionStorage.setItem(SAVED_KEY, String(savedId));
      } catch {
        /* private mode: no tick, still saved */
      }
      reloadWith(result.message);
    }
  });

  document.querySelectorAll('[data-address-delete]').forEach((button) => {
    button.addEventListener('click', async () => {
      const confirmed = await Nx.confirm({
        title: 'Remove this address?',
        message: `The address for ${button.dataset.name} will be deleted. This cannot be undone.`,
        confirmLabel: 'Remove address',
      });
      if (!confirmed) return;
      Nx.busy(button, true, 'Removing…');
      try {
        const result = await Nx.api(
          `/api/addresses/${encodeURIComponent(button.dataset.addressDelete)}`,
          {method: 'DELETE'},
        );
        reloadWith(result.message);
      } catch (error) {
        Nx.busy(button, false);
        Nx.toast(error.message, 'error');
      }
    });
  });

  document.querySelectorAll('[data-address-default]').forEach((button) => {
    button.addEventListener('click', async () => {
      Nx.busy(button, true, 'Saving…');
      try {
        const result = await Nx.api(
          `/api/addresses/${encodeURIComponent(button.dataset.addressDefault)}/default`,
          {method: 'PATCH'},
        );
        reloadWith(result.message);
      } catch (error) {
        Nx.busy(button, false);
        Nx.toast(error.message, 'error');
      }
    });
  });
})();
