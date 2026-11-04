// Checkout: three steps (address, summary, payment) on one page. The server works out every
// price and total again when the order is placed; this page only sends the address and method.
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

  // Place the order.
  const form = page.querySelector("[data-place-order]");
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const address = chosenAddress();
    const method = form.querySelector('input[name="paymentMethod"]:checked');
    if (!address) {
      open(1);
      return;
    }
    const reply = await Nx.submitForm(form, {
      url: "/api/orders",
      body: { addressId: address.value, paymentMethod: method ? method.value : "" },
      busyLabel: "Placing your order…"
    });
    if (!reply) return;
    Nx.setCartCount(0);
    window.location.assign(reply.redirect);
  });
})();
