// Checkout: three steps (address, summary, payment) on one page, plus the coupon box and the
// wallet. The server works out every price, the coupon discount and every total; this page only
// sends the address, the payment method, the coupon code and whether to use the wallet, then
// shows the totals the server sends back.
(function () {
  "use strict";

  const page = document.querySelector("[data-checkout]");
  if (!page) return;
  // "cart" buys the whole cart; "buynow" buys only the Buy now product and leaves the cart alone.
  // The server is told on every call, so both checkouts share all the code below.
  const source = page.dataset.source === "buynow" ? "buynow" : "cart";
  const isBuyNow = source === "buynow";
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
    // The bar under the steps fills up; on phones the Pay button sticks to the bottom on step 3.
    const bar = page.querySelector(".stepper");
    if (bar) bar.style.setProperty("--progress", String((number - 1) / (steps.length - 1)));
    page.classList.toggle("is-paying", number === steps.length);
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
  const cards = [...form.querySelectorAll("[data-pay-card]")];
  const methodInput = name => form.querySelector(`[data-pay-card="${name}"] input[name="paymentMethod"]`);
  const restBox = form.querySelector("[data-pay-rest]");
  const walletNote = form.querySelector("[data-wallet-note]");
  const codNote = form.querySelector("[data-cod-note]");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
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
    const started = performance.now();
    const step = now => {
      if (el.dataset.value !== String(paise)) return; // a newer total took over
      const progress = Math.min(1, (now - started) / 500);
      const eased = 1 - Math.pow(1 - progress, 3);
      const value = progress < 1 ? Math.round((from + (paise - from) * eased) / 100) * 100 : paise;
      el.textContent = prefix + Nx.formatPrice(value);
      el.classList.toggle("is-counting", progress < 1);
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function setMoney(name, paise) {
    page.querySelectorAll(`[data-sum="${name}"]`).forEach(el => {
      if (el.hasAttribute("data-free") && !paise) {
        el.dataset.value = "0";
        el.innerHTML = '<span class="text-success">Free</span>';
      } else {
        countTo(el, paise, el.hasAttribute("data-minus") ? "−" : "");
      }
    });
  }

  const chosenMethod = () => (form.querySelector('input[name="paymentMethod"]:checked') || {}).value || "";
  const restMethod = () => (form.querySelector('input[name="restMethod"]:checked') || {}).value || "";
  const usingWallet = () => chosenMethod() === "wallet";

  // The selected card opens to show its details; the others close.
  function syncCards(animate = true) {
    cards.forEach(card => {
      const on = card.querySelector('input[name="paymentMethod"]').checked;
      card.classList.toggle("is-selected", on);
      const details = card.querySelector("[data-pay-details]");
      if (details.hidden !== on) return;
      details.hidden = !on;
      if (on && animate) {
        details.classList.remove("is-entering");
        void details.offsetWidth;
        details.classList.add("is-entering");
      }
    });
  }

  // What pressing the button will do, from the chosen card (and how to pay the rest).
  // UPI is paid through Razorpay too; it only opens Razorpay's window on UPI first.
  const online = kind => kind === "upi" ? { kind: "razorpay", upi: true } : { kind };
  function plan() {
    const method = chosenMethod();
    if (method !== "wallet") return { ...online(method), useWallet: false };
    if (current && current.coveredByWallet) return { kind: "wallet", useWallet: true };
    return { ...online(restMethod()), useWallet: true };
  }

  function updatePlaceText() {
    // Looked up each time: the busy spinner swaps the button's contents and puts them back.
    const placeText = form.querySelector("[data-place-text]");
    const p = plan();
    const t = current && current.totals;
    const amount = t ? Nx.formatPrice(p.kind === "wallet" ? t.walletUsed : t.total) : "";
    placeText.textContent = p.kind === "razorpay" ? `Pay ${amount} securely`
      : p.kind === "wallet" ? `Pay ${amount} from wallet`
      : p.kind === "cod" ? `Place order · ${amount} on delivery`
      : "Choose how to pay";
  }

  function updateButton() {
    const p = plan();
    placeButton.disabled = processing || !current || current.problems.length > 0 || !p.kind;
    updatePlaceText();
  }

  function render(quote) {
    current = quote;
    const t = quote.totals;
    ["mrpTotal", "discount", "couponDiscount", "deliveryFee", "walletUsed", "total"].forEach(name => setMoney(name, t[name]));
    setMoney("savings", t.discount + t.couponDiscount);
    page.querySelectorAll('[data-sum-text="couponCode"]').forEach(el => { el.textContent = t.couponCode; });
    page.querySelector('[data-sum-row="couponDiscount"]').hidden = !t.couponDiscount;
    page.querySelector('[data-sum-row="walletUsed"]').hidden = !t.walletUsed;
    page.querySelector("[data-saving]").hidden = !(t.discount + t.couponDiscount > 0);

    // Cash on Delivery depends on the amount left to pay.
    if (!usingWallet()) {
      const cod = methodInput("cod");
      cod.disabled = !quote.codAllowed;
      cod.closest("[data-pay-card]").classList.toggle("is-disabled", !quote.codAllowed);
      codNote.textContent = quote.codAllowed ? codNote.dataset.ok : codNote.dataset.off;
      if (cod.checked && cod.disabled) {
        cod.checked = false;
        const online = methodInput("upi");
        if (!online.disabled) online.checked = true;
      }
    } else if (restBox) {
      restBox.hidden = quote.coveredByWallet;
      const restCod = restBox.querySelector('input[value="cod"]');
      const restOnline = restBox.querySelector('input[value="upi"]');
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
    summary.classList.add("is-updating");
    placeButton.disabled = true;
    try {
      const { quote } = await Nx.api("/api/checkout/quote", { method: "POST", body: { useWallet: usingWallet(), source } });
      if (ticket === refreshing) render(quote);
    } catch (error) {
      Nx.toast(error.message, "error");
      updateButton();
    } finally {
      if (ticket === refreshing) summary.classList.remove("is-updating");
    }
  }

  form.addEventListener("change", event => {
    if (event.target.name === "paymentMethod") {
      Nx.clearErrors(form);
      syncCards();
      refresh();
    }
    if (event.target.name === "restMethod") updateButton();
  });
  syncCards(false);
  refresh();

  // ---------- Coupons ----------
  const couponBox = page.querySelector("[data-coupon]");
  const couponForm = couponBox.querySelector("[data-coupon-form]");
  const applied = couponBox.querySelector("[data-coupon-applied]");
  const notice = couponBox.querySelector("[data-coupon-notice]");

  function renderCoupon(quote) {
    applied.hidden = !quote.coupon;
    couponForm.hidden = Boolean(quote.coupon);
    if (quote.coupon) {
      applied.querySelector("[data-coupon-code]").textContent = quote.coupon.code;
      applied.querySelector("[data-coupon-saving]").textContent = `You save ${Nx.formatPrice(quote.coupon.saving)}`;
    }
    notice.hidden = !quote.couponNotice;
    notice.querySelector("span").textContent = quote.couponNotice || "";
  }

  async function applyCoupon(code, button) {
    Nx.clearErrors(couponForm);
    Nx.busy(button, true, "Applying…");
    try {
      const reply = await Nx.api("/api/checkout/coupon", { method: "POST", body: { code, source } });
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
      const reply = await Nx.api(`/api/checkout/coupon?source=${source}`, { method: "DELETE" });
      Nx.toast(reply.message);
      await refresh();
      couponForm.elements.code.focus();
    } catch (error) {
      Nx.toast(error.message, "error");
    } finally {
      Nx.busy(button, false);
    }
  });

  // ---------- Place the order ----------
  // After a failed or cancelled online payment: cancel that unpaid order (any wallet amount and
  // coupon use come straight back), then let the shopper pick again. The cart was never touched.
  async function chooseOther(orderId) {
    processing = false;
    if (orderId) {
      try {
        await Nx.api(`/api/orders/${encodeURIComponent(orderId)}/cancel`, { method: "POST", body: { reason: "" } });
      } catch {
        // It stays in Your orders with a Retry button; nothing is lost.
      }
    }
    await refresh();
    Nx.toast("Choose another way to pay. Your cart is just as you left it.");
  }

  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (processing || placeButton.disabled) return;
    const address = chosenAddress();
    if (!address) {
      open(1);
      return;
    }
    const p = plan();
    if (!p.kind) {
      Nx.showErrors(form, { paymentMethod: "Choose how to pay." });
      return;
    }
    processing = true;
    // Online payment: the server saves the order unpaid and creates a Razorpay order for the
    // amount it worked out; then Razorpay's secure window takes the payment.
    if (p.kind === "razorpay") {
      const checkout = await Nx.submitForm(form, {
        url: "/api/payments/razorpay/order",
        body: { addressId: address.value, useWallet: p.useWallet, source },
        busyLabel: "Preparing secure payment…"
      });
      if (checkout && Nx.payOnline) {
        placeButton.disabled = true;
        Nx.payOnline(checkout, Nx.prefillFrom(page), { onChooseOther: chooseOther, keepCart: isBuyNow, upi: Boolean(p.upi) });
      } else {
        processing = false;
        refresh();
      }
      return;
    }
    const reply = await Nx.submitForm(form, {
      url: "/api/orders",
      body: { addressId: address.value, paymentMethod: p.kind, useWallet: p.useWallet, source },
      busyLabel: "Placing your order…"
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
