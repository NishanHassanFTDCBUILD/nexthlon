// Razorpay Checkout, shared by the checkout page and the "Retry payment" button.
// The server gives us only the public key id, its Razorpay order id, the amount and the
// currency. After paying, the ids and signature go back to our server, which checks the
// signature with the secret it never shares, and only then marks the order paid.
(function () {
  "use strict";

  const Nx = window.Nx || (window.Nx = {});

  async function reportFailure(razorpayOrderId, reason) {
    try {
      const reply = await Nx.api("/api/payments/razorpay/failed", { method: "POST", body: { razorpay_order_id: razorpayOrderId, reason } });
      Nx.flash(reply.message, "error");
      window.location.assign(reply.redirect);
    } catch (error) {
      Nx.toast(error.message, "error");
    }
  }

  // checkout: { key_id, razorpay_order_id, amount, currency }; prefill: { name, email, contact }
  Nx.payOnline = function payOnline(checkout, prefill = {}) {
    if (typeof window.Razorpay !== "function") {
      Nx.toast("The payment window could not load. Check your connection, or turn off blockers for checkout.razorpay.com.", "error");
      return reportFailure(checkout.razorpay_order_id, "Checkout script did not load");
    }
    let settled = false;
    const rzp = new window.Razorpay({
      key: checkout.key_id,
      order_id: checkout.razorpay_order_id,
      amount: checkout.amount,
      currency: checkout.currency,
      name: "Nexthlon",
      description: "Sports gear order",
      prefill,
      theme: { color: "#ff7a1a" },
      handler: async response => {
        settled = true;
        try {
          const reply = await Nx.api("/api/payments/razorpay/verify", {
            method: "POST",
            body: {
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature
            }
          });
          Nx.setCartCount && Nx.setCartCount(0);
          Nx.flash(reply.message, reply.paid ? "success" : "error");
          window.location.assign(reply.redirect);
        } catch (error) {
          Nx.toast(error.message, "error");
        }
      },
      modal: {
        // The shopper closed the window without paying: keep the cart, offer a retry.
        ondismiss: () => {
          if (!settled) reportFailure(checkout.razorpay_order_id, "Closed the payment window");
        }
      }
    });
    rzp.on("payment.failed", event => {
      settled = true;
      const reason = event && event.error ? event.error.description || "" : "";
      reportFailure(checkout.razorpay_order_id, reason);
    });
    rzp.open();
    return null;
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
        Nx.payOnline(checkout, prefillFrom(page));
      } catch (error) {
        Nx.toast(error.message, "error");
      } finally {
        Nx.busy(button, false);
      }
    });
  });
})();
