// Checkout: three steps (address, summary, payment) on one page, plus the coupon box and the
// wallet. The server works out every price, the coupon discount and every total; this page only
// sends the address, the payment method, the coupon code and whether to use the wallet, then
// shows the totals the server sends back.
(function () {
  "use strict";

  const page = document.querySelector("[data-checkout]");
  if (!page) return;
  const steps = [...page.querySelectorAll("[data-step]")];
  const stepper = [...page.querySelectorAll("[data-stepper]")];

  function open(number) {
    steps.forEach(step => {
      const n = Number(step.dataset.step);
      const body = step.querySelector(".step-body");
      const edit = step.querySelector("[data-step-edit]");
      step.classList.toggle("is-open", n === number);
      step.classList.toggle("is-done", n < number);
      body.hidden = n !== number;
      if (n === number) {
        // The step slides in (motion.css); restarting the class replays it.
        body.classList.remove("step-enter");
        void body.offsetWidth;
        body.classList.add("step-enter");
      }
      if (edit) edit.hidden = n >= number;
    });
    stepper.forEach(item => {
      if (Number(item.dataset.stepper) === number) item.setAttribute("aria-current", "step");
      else item.removeAttribute("aria-current");
      item.classList.toggle("is-done", Number(item.dataset.stepper) < number);
    });
    const current = steps[number - 1];
    const heading = current.querySelector("h2");
    heading.setAttribute("tabindex", "-1");
    heading.focus();
  }

  const chosenAddress = () => page.querySelector('input[name="addressId"]:checked');
  const deliveryNote = page.querySelector("[data-checkout-delivery]");

  async function showDelivery(pincode) {
    if (!deliveryNote || !pincode) return;
    deliveryNote.className = "delivery-result is-loading";
    deliveryNote.textContent = "Working out the delivery date…";
    try {
      const { estimate } = await Nx.api(`/api/delivery/estimate?pincode=${encodeURIComponent(pincode)}`);
      deliveryNote.className = "delivery-result is-ok";
      deliveryNote.textContent = `Estimated delivery: ${estimate.label}`;
    } catch {
      deliveryNote.className = "delivery-result";
      deliveryNote.textContent = "";
    }
  }

  page.querySelectorAll("[data-step-next]").forEach(button => {
    button.addEventListener("click", () => {
      const from = Number(button.dataset.stepNext);
      if (from === 1) {
        const address = chosenAddress();
        const error = page.querySelector('[data-error-for="addressId"]');
        if (!address) {
          error.textContent = "Choose a delivery address.";
          return;
        }
        error.textContent = "";
        steps[0].querySelector("[data-step-summary]").textContent = address.dataset.label;
        showDelivery(address.dataset.pincode);
      }
      if (from === 2) {
        const count = page.querySelectorAll(".checkout-items li").length;
        steps[1].querySelector("[data-step-summary]").textContent = `${count} ${count === 1 ? "item" : "items"}`;
      }
      open(from + 1);
    });
  });
  page.querySelectorAll("[data-step-edit]").forEach(button => {
    button.addEventListener("click", () => open(Number(button.dataset.stepEdit)));
  });

  // ---------- Totals from the server ----------
  const form = page.querySelector("[data-place-order]");
  const placeButton = form.querySelector('[type="submit"]');
  const summary = page.querySelector("[data-summary]");
  const walletBox = form.querySelector("[data-use-wallet]");
  const walletNote = form.querySelector("[data-wallet-note]");
  const payWallet = form.querySelector("[data-pay-wallet]");
  const payCod = form.querySelector("[data-pay-cod]");
  const payOnline = form.querySelector("[data-pay-online]");
  const codInput = payCod.querySelector("input");
  const onlineInput = payOnline.querySelector("input");
  const onlineReady = onlineInput.dataset.onlineReady === "true";
  const codNote = payCod.querySelector("[data-cod-note]");
  let blocked = placeButton.disabled;

  function setMoney(name, paise) {
    page.querySelectorAll(`[data-sum="${name}"]`).forEach(el => {
      if (el.hasAttribute("data-free") && !paise) {
        el.innerHTML = '<span class="text-success">Free</span>';
      } else {
        el.textContent = (el.hasAttribute("data-minus") ? "−" : "") + Nx.formatPrice(paise);
      }
    });
  }

  function chosenMethod() {
    const checked = form.querySelector('input[name="paymentMethod"]:checked');
    return checked ? checked.value : "";
  }

  function updatePlaceText() {
    const method = chosenMethod();
    // Looked up each time: the busy spinner swaps the button's contents and puts them back.
    const placeText = form.querySelector("[data-place-text]");
    placeText.textContent = method === "razorpay" ? "Pay securely" : method === "wallet" ? "Pay with wallet" : "Place order";
  }

  function render(quote) {
    const t = quote.totals;
    ["mrpTotal", "discount", "couponDiscount", "deliveryFee", "walletUsed", "total"].forEach(name => setMoney(name, t[name]));
    setMoney("savings", t.discount + t.couponDiscount);
    page.querySelectorAll('[data-sum-text="couponCode"]').forEach(el => { el.textContent = t.couponCode; });
    page.querySelector('[data-sum-row="couponDiscount"]').hidden = !t.couponDiscount;
    page.querySelector('[data-sum-row="walletUsed"]').hidden = !t.walletUsed;
    page.querySelector("[data-saving]").hidden = !(t.discount + t.couponDiscount > 0);

    // Payment choices follow the new total.
    const covered = quote.coveredByWallet;
    payWallet.hidden = !covered;
    payWallet.querySelector("input").disabled = !covered;
    payCod.hidden = covered;
    payOnline.hidden = covered;
    codInput.disabled = covered || !quote.codAllowed;
    onlineInput.disabled = covered || !onlineReady;
    codNote.textContent = quote.codAllowed ? codNote.dataset.ok : codNote.dataset.off;
    if (covered) payWallet.querySelector("input").checked = true;
    else if (!chosenMethod() || form.querySelector('input[name="paymentMethod"]:checked').disabled) {
      const next = !codInput.disabled ? codInput : !onlineInput.disabled ? onlineInput : null;
      form.querySelectorAll('input[name="paymentMethod"]').forEach(input => { input.checked = input === next; });
    }
    if (walletNote) {
      walletNote.textContent = t.walletUsed ? (covered ? "It covers this whole order." : `${Nx.formatPrice(t.walletUsed)} will be used, pay the rest below.`) : "";
    }
    blocked = Boolean(quote.problems.length) || !chosenMethod();
    placeButton.disabled = blocked;
    updatePlaceText();
    renderCoupon(quote);
  }

  let refreshing = 0;
  async function refresh() {
    const ticket = ++refreshing;
    summary.classList.add("is-updating");
    placeButton.disabled = true;
    try {
      const { quote } = await Nx.api("/api/checkout/quote", { method: "POST", body: { useWallet: Boolean(walletBox && walletBox.checked) } });
      if (ticket === refreshing) render(quote);
    } catch (error) {
      Nx.toast(error.message, "error");
      placeButton.disabled = blocked;
    } finally {
      if (ticket === refreshing) summary.classList.remove("is-updating");
    }
  }

  form.addEventListener("change", event => {
    if (event.target.name === "paymentMethod") updatePlaceText();
    if (event.target === walletBox) refresh();
  });

  // ---------- Coupons ----------
  const couponBox = page.querySelector("[data-coupon]");
  const couponForm = couponBox.querySelector("[data-coupon-form]");
  const applied = couponBox.querySelector("[data-coupon-applied]");
  const notice = couponBox.querySelector("[data-coupon-notice]");
  const toggle = couponBox.querySelector("[data-coupon-toggle]");
  const list = couponBox.querySelector("[data-coupon-list]");

  function renderCoupon(quote) {
    applied.hidden = !quote.coupon;
    couponForm.hidden = Boolean(quote.coupon);
    if (quote.coupon) {
      applied.querySelector("[data-coupon-code]").textContent = quote.coupon.code;
      applied.querySelector("[data-coupon-saving]").textContent = `You save ${Nx.formatPrice(quote.coupon.saving)}`;
    }
    notice.hidden = !quote.couponNotice;
    notice.querySelector("span").textContent = quote.couponNotice || "";
    if (!list.hidden) loadCoupons();
  }

  async function applyCoupon(code, button) {
    Nx.clearErrors(couponForm);
    Nx.busy(button, true, "Applying…");
    try {
      const reply = await Nx.api("/api/checkout/coupon", { method: "POST", body: { code } });
      Nx.toast(reply.message);
      couponForm.reset();
      await refresh();
      applied.classList.remove("is-popped");
      void applied.offsetWidth;
      applied.classList.add("is-popped");
    } catch (error) {
      Nx.showErrors(couponForm, error.fieldErrors && error.fieldErrors.code ? error.fieldErrors : { code: error.message });
      if (couponForm.hidden) Nx.toast(error.message, "error");
    } finally {
      Nx.busy(button, false);
    }
  }

  couponForm.addEventListener("submit", event => {
    event.preventDefault();
    const code = couponForm.elements.code.value.replace(/\s+/g, "").toUpperCase();
    if (!/^[A-Z0-9]{3,20}$/.test(code)) {
      Nx.clearErrors(couponForm);
      Nx.showErrors(couponForm, { code: "Enter a valid coupon code." });
      couponForm.elements.code.focus();
      return;
    }
    applyCoupon(code, couponForm.querySelector('[type="submit"]'));
  });

  couponBox.querySelector("[data-coupon-remove]").addEventListener("click", async event => {
    const button = event.currentTarget;
    Nx.busy(button, true, "Removing…");
    try {
      const reply = await Nx.api("/api/checkout/coupon", { method: "DELETE" });
      Nx.toast(reply.message);
      await refresh();
      couponForm.elements.code.focus();
    } catch (error) {
      Nx.toast(error.message, "error");
    } finally {
      Nx.busy(button, false);
    }
  });

  function couponItem(coupon) {
    const item = document.createElement("li");
    item.className = `coupon-item${coupon.eligible ? "" : " is-off"}`;
    const body = document.createElement("div");
    const code = document.createElement("strong");
    code.className = "coupon-tag";
    code.textContent = coupon.code;
    const title = document.createElement("span");
    title.className = "coupon-title";
    title.textContent = coupon.title;
    const note = document.createElement("small");
    note.className = coupon.eligible ? "text-success" : "muted";
    note.textContent = coupon.eligible ? `You save ${Nx.formatPrice(coupon.saving)}` : coupon.problem;
    body.append(code, title);
    if (coupon.description) {
      const description = document.createElement("small");
      description.className = "muted";
      description.textContent = coupon.description;
      body.append(description);
    }
    body.append(note);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-ghost btn-sm";
    button.textContent = "Apply";
    button.disabled = !coupon.eligible;
    button.setAttribute("aria-label", `Apply coupon ${coupon.code}`);
    button.addEventListener("click", () => applyCoupon(coupon.code, button));
    item.append(body, button);
    return item;
  }

  async function loadCoupons() {
    list.innerHTML = '<div class="coupon-skeleton" aria-hidden="true"><span class="skeleton"></span><span class="skeleton"></span></div><p class="sr-only" role="status">Loading coupons…</p>';
    try {
      const { coupons, applied: current } = await Nx.api("/api/coupons");
      const shown = coupons.filter(coupon => coupon.code !== current);
      list.innerHTML = "";
      if (!shown.length) {
        list.innerHTML = '<p class="coupon-empty muted">No other coupons right now. Check back soon.</p>';
        return;
      }
      const ul = document.createElement("ul");
      ul.className = "coupon-list";
      shown.forEach(coupon => ul.append(couponItem(coupon)));
      list.append(ul);
    } catch (error) {
      list.innerHTML = "";
      const message = document.createElement("p");
      message.className = "coupon-empty text-danger";
      message.textContent = error.message;
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "link-btn";
      retry.textContent = "Try again";
      retry.addEventListener("click", loadCoupons);
      message.append(" ", retry);
      list.append(message);
    }
  }

  toggle.addEventListener("click", () => {
    const opening = list.hidden;
    list.hidden = !opening;
    toggle.setAttribute("aria-expanded", String(opening));
    toggle.classList.toggle("is-open", opening);
    if (opening) loadCoupons();
  });

  // ---------- Place the order ----------
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const address = chosenAddress();
    const method = chosenMethod();
    const useWallet = Boolean(walletBox && walletBox.checked);
    if (!address) {
      open(1);
      return;
    }
    // Online payment: the server saves the order unpaid and creates a Razorpay order,
    // then Razorpay Checkout takes the payment.
    if (method === "razorpay") {
      const checkout = await Nx.submitForm(form, {
        url: "/api/payments/razorpay/order",
        body: { addressId: address.value, useWallet },
        busyLabel: "Opening payment…"
      });
      if (checkout && Nx.payOnline) Nx.payOnline(checkout, Nx.prefillFrom(page));
      return;
    }
    const reply = await Nx.submitForm(form, {
      url: "/api/orders",
      body: { addressId: address.value, paymentMethod: method, useWallet },
      busyLabel: "Placing your order…"
    });
    if (!reply) {
      // Prices, stock or the wallet may have changed: show the latest totals.
      refresh();
      return;
    }
    Nx.setCartCount(0);
    window.location.assign(reply.redirect);
  });
})();
