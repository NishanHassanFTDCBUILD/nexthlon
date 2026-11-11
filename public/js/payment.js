// Online payment with Razorpay Standard Checkout, wrapped in our own full-screen overlay:
//   opening   a short glass screen with a lock, then Razorpay's secure window opens
//   verifying the ids and signature go to our server, which checks them with the secret it never shares
//   checking  the connection dropped: ask the server a few times where the payment stands
//   success   a checkmark, confetti, the order id and the amount
//   failed    a cross, the reason in plain words, Retry payment or Choose another method
// Card and UPI details are only ever typed inside Razorpay's window, never on this site.
(function () {
  "use strict";

  const Nx = window.Nx || (window.Nx = {});
  const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const wait = ms => new Promise(resolve => setTimeout(resolve, reduced() ? Math.min(ms, 150) : ms));
  const BRAND = "#ff7a1a";

  // ---------- The overlay ----------
  const overlay = document.querySelector("[data-pay-overlay]");
  const dialog = overlay && overlay.querySelector("[data-pay-dialog]");
  let returnFocus = null;
  let escapeAction = null;

  function focusables() {
    return [...dialog.querySelectorAll("button:not([disabled]), a[href]")].filter(el => !el.closest("[hidden]"));
  }

  function trapFocus(event) {
    if (event.key === "Escape" && escapeAction) {
      event.preventDefault();
      escapeAction();
      return;
    }
    if (event.key !== "Tab") return;
    const items = focusables();
    if (!items.length) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function show() {
    if (!overlay.hidden) return;
    returnFocus = document.activeElement;
    overlay.hidden = false;
    document.documentElement.classList.add("is-pay-locked");
    void overlay.offsetWidth;
    overlay.classList.add("is-open");
    document.addEventListener("keydown", trapFocus);
  }

  function hide() {
    overlay.classList.remove("is-open");
    document.removeEventListener("keydown", trapFocus);
    document.documentElement.classList.remove("is-pay-locked");
    escapeAction = null;
    setTimeout(() => { overlay.hidden = true; }, reduced() ? 0 : 260);
    if (returnFocus && document.contains(returnFocus)) returnFocus.focus();
  }

  // state: opening | waiting | verifying | success | failed
  // actions: [{ label, icon, tone: "primary" | "ghost", onClick, escape }]
  function setState(state, { title, text = "", actions = [], result = null } = {}) {
    show();
    overlay.dataset.state = state;
    const card = dialog;
    // Restart the state's entrance animation (the cross shakes, the check draws).
    card.classList.remove("is-entering");
    void card.offsetWidth;
    card.classList.add("is-entering");
    dialog.querySelector("[data-pay-title]").textContent = title;
    dialog.querySelector("[data-pay-text]").textContent = text;
    dialog.querySelector("[data-pay-live]").textContent = `${title} ${text}`;

    const resultBox = dialog.querySelector("[data-pay-result]");
    resultBox.hidden = !result;
    if (result) {
      resultBox.querySelector("[data-pay-order]").textContent = result.orderId;
      resultBox.querySelector("[data-pay-amount]").textContent = Nx.formatPrice(result.amount);
    }

    const box = dialog.querySelector("[data-pay-actions]");
    box.innerHTML = "";
    escapeAction = null;
    actions.forEach(action => {
      const button = document.createElement(action.href ? "a" : "button");
      if (action.href) button.href = action.href;
      else button.type = "button";
      button.className = `btn ${action.tone === "ghost" ? "btn-ghost" : "btn-primary"} btn-lg`;
      button.textContent = action.label;
      button.addEventListener("click", event => {
        if (!action.onClick) return;
        event.preventDefault();
        action.onClick(button);
      });
      box.append(button);
      if (action.escape) escapeAction = () => action.onClick(button);
    });
    const first = focusables()[0];
    if ((state === "success" || state === "failed") && first) first.focus();
    else dialog.focus();
  }

  if (overlay) {
    const copy = overlay.querySelector("[data-pay-copy]");
    copy.addEventListener("click", async () => {
      const text = overlay.querySelector("[data-pay-order]").textContent;
      try {
        await navigator.clipboard.writeText(text);
        Nx.toast("Order ID copied");
      } catch {
        Nx.toast(`Your order ID is ${text}`);
      }
    });
  }

  // ---------- Server calls ----------
  async function reportFailure(razorpayOrderId, reason) {
    try {
      return await Nx.api("/api/payments/razorpay/failed", { method: "POST", body: { razorpay_order_id: razorpayOrderId, reason } });
    } catch {
      return null;
    }
  }

  // Razorpay's error, in plain words.
  function friendlyReason(error) {
    const description = error && error.description ? String(error.description) : "";
    const reason = error && error.reason ? String(error.reason) : "";
    if (/insufficient/i.test(description + reason)) return "Your account does not have enough balance for this payment.";
    if (/declined|rejected/i.test(description + reason)) return "Your bank declined the payment.";
    if (/timed? ?out|timeout/i.test(description + reason)) return "The payment took too long and timed out.";
    return description ? description.replace(/\.?$/, ".") : "The payment did not go through.";
  }

  // ---------- The flow ----------
  // checkout: { key_id, razorpay_order_id, amount, currency } exactly as the server sent it.
  // options.onChooseOther: what "Choose another method" does on this page (checkout only).
  Nx.payOnline = function payOnline(checkout, prefill = {}, options = {}) {
    if (!overlay) return;
    const flow = { orderId: options.orderId || "", amount: checkout.amount, done: false };

    function success(orderId, amount) {
      flow.done = true;
      // A Buy now order leaves the cart as it was, so its count stays.
      if (Nx.setCartCount && !options.keepCart) Nx.setCartCount(0);
      // The page now stands for the paid order: Back and refresh can never pay again.
      try {
        window.history.replaceState(null, "", `/orders/${orderId}/success`);
      } catch {
        // Older browsers: the buttons below still replace this page.
      }
      setState("success", {
        title: "Payment successful",
        text: "Thank you! Your order is confirmed and on its way to being packed.",
        result: { orderId, amount },
        actions: [
          { label: "View order", onClick: () => window.location.replace(`/orders/${orderId}`) },
          { label: "Continue shopping", tone: "ghost", onClick: () => window.location.replace("/products") }
        ]
      });
      setTimeout(() => Nx.confetti && Nx.confetti(overlay.querySelector("[data-pay-confetti]"), { keep: true }), reduced() ? 0 : 450);
    }

    function failed(title, text, { canRetry = true } = {}) {
      flow.done = true;
      const actions = [];
      if (canRetry && flow.orderId) actions.push({ label: "Retry payment", onClick: retry });
      if (options.onChooseOther) {
        actions.push({ label: "Choose another method", tone: "ghost", escape: true, onClick: async button => {
          Nx.busy(button, true, "One moment…");
          await options.onChooseOther(flow.orderId);
          hide();
        } });
      } else {
        actions.push({ label: "Close", tone: "ghost", escape: true, onClick: () => hide() });
      }
      setState("failed", { title, text, actions });
    }

    async function retry(button) {
      Nx.busy(button, true, "Opening payment…");
      try {
        const fresh = await Nx.api(`/api/payments/razorpay/retry/${encodeURIComponent(flow.orderId)}`, { method: "POST" });
        Nx.payOnline(fresh, prefill, { ...options, orderId: flow.orderId });
      } catch (error) {
        failed("We could not retry this payment", error.message, { canRetry: false });
      }
    }

    // The verify call did not get through: ask where the payment stands a few times.
    async function checkStatus(response) {
      setState("verifying", { title: "We are checking your payment status…", text: "This can take a few seconds. Please keep this page open." });
      for (let attempt = 0; attempt < 6; attempt += 1) {
        await wait(2500);
        try {
          const status = await Nx.api(`/api/payments/razorpay/status/${encodeURIComponent(response.razorpay_order_id)}`);
          flow.orderId = status.orderId;
          if (status.paid) return success(status.orderId, status.amount);
          if (status.paymentStatus === "failed") return failed("Payment failed", "The payment did not go through. No money was taken, and your cart is safe.");
          // Still pending: the verify call is safe to send again.
          const reply = await Nx.api("/api/payments/razorpay/verify", { method: "POST", body: response });
          if (reply.paid) return success(reply.orderId, flow.amount);
        } catch (error) {
          if (error.status && error.status < 500 && error.status !== 0) {
            return failed("We could not confirm this payment", error.message, { canRetry: false });
          }
        }
      }
      flow.done = true;
      setState("failed", {
        title: "Still confirming your payment",
        text: "If money left your account, your order will update by itself in a few minutes, and anything not used is refunded automatically.",
        actions: [
          ...(flow.orderId ? [{ label: "View order", onClick: () => window.location.replace(`/orders/${flow.orderId}`) }] : []),
          { label: "Go to your orders", tone: "ghost", onClick: () => window.location.replace("/orders") }
        ]
      });
    }

    async function verify(response) {
      setState("verifying", { title: "Verifying your payment…", text: "Please wait a moment and don't close this page." });
      try {
        const [reply] = await Promise.all([
          Nx.api("/api/payments/razorpay/verify", { method: "POST", body: response }),
          wait(700)
        ]);
        flow.orderId = reply.orderId;
        if (reply.paid && /\/success$/.test(reply.redirect)) return success(reply.orderId, flow.amount);
        return failed("Payment received, order not placed", reply.message, { canRetry: false });
      } catch (error) {
        if (error.status === 0 || error.status >= 500) return checkStatus(response);
        return failed("We could not confirm this payment", error.message, { canRetry: false });
      }
    }

    async function start() {
      setState("opening", { title: "Opening secure payment…", text: "You will pay in Razorpay's secure window. Nexthlon never sees your card or UPI details." });
      await wait(600);
      if (typeof window.Razorpay !== "function") {
        const reply = await reportFailure(checkout.razorpay_order_id, "Checkout script did not load");
        if (reply) flow.orderId = reply.orderId;
        return failed("The payment window could not load", "Check your connection, or allow checkout.razorpay.com if you use an ad blocker. Your cart is safe.");
      }

      const rzp = new window.Razorpay({
        key: checkout.key_id,
        order_id: checkout.razorpay_order_id,
        // The amount and currency come only from our server.
        amount: checkout.amount,
        currency: checkout.currency,
        name: "Nexthlon",
        description: "Secure payment for your Nexthlon order",
        // Razorpay's window is https, so it can only show a logo from an https address
        // (on http://localhost it would be blocked as mixed content).
        ...(window.location.protocol === "https:" ? { image: `${window.location.origin}/img/favicon.svg` } : {}),
        prefill,
        theme: { color: BRAND },
        handler: response => {
          flow.done = true;
          verify({
            razorpay_order_id: response.razorpay_order_id,
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_signature: response.razorpay_signature
          });
        },
        modal: {
          backdropclose: false,
          escape: true,
          // The shopper closed the window without paying: keep the cart and offer a retry.
          ondismiss: async () => {
            if (flow.done) return;
            flow.done = true;
            const reply = await reportFailure(checkout.razorpay_order_id, "Closed the payment window");
            if (reply) flow.orderId = reply.orderId;
            failed("Payment cancelled", "You closed the payment window, so no money was taken. Your cart is safe.");
          }
        }
      });
      rzp.on("payment.failed", async event => {
        if (flow.done) return;
        flow.done = true;
        const reason = friendlyReason(event && event.error);
        try {
          rzp.close();
        } catch {
          // Already closed.
        }
        const reply = await reportFailure(checkout.razorpay_order_id, reason);
        if (reply) flow.orderId = reply.orderId;
        failed("Payment failed", `${reason} If any money was deducted, it is refunded automatically. Your cart is safe.`);
      });
      setState("waiting", { title: "Complete your payment", text: "Finish paying in the secure Razorpay window." });
      rzp.open();
    }

    start();
  };

  function prefillFrom(element) {
    return {
      name: element.dataset.prefillName || "",
      email: element.dataset.prefillEmail || "",
      contact: element.dataset.prefillPhone || ""
    };
  }
  Nx.prefillFrom = prefillFrom;

  // "Retry payment" on the order page.
  document.querySelectorAll("[data-retry-payment]").forEach(button => {
    button.addEventListener("click", async () => {
      const page = button.closest("[data-order]");
      Nx.busy(button, true, "Opening payment…");
      try {
        const checkout = await Nx.api(`/api/payments/razorpay/retry/${encodeURIComponent(page.dataset.orderId)}`, { method: "POST" });
        Nx.payOnline(checkout, prefillFrom(page), { orderId: page.dataset.orderId });
      } catch (error) {
        Nx.toast(error.message, "error");
      } finally {
        Nx.busy(button, false);
      }
    });
  });
})();
