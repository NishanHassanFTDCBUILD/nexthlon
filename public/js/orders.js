// Order page: cancel the whole order or one item, and ask for a return. The server checks
// that the order is yours and that each step is still allowed.
(function () {
  "use strict";

  const page = document.querySelector("[data-order]");
  if (!page) return;
  const orderId = encodeURIComponent(page.dataset.orderId);

  function reloadWith(message) {
    Nx.flash(message);
    window.location.reload();
  }

  document.querySelectorAll("dialog [data-dialog-close]").forEach(button => {
    button.addEventListener("click", () => button.closest("dialog").close());
  });

  // ---------- Cancel ----------
  const cancelDialog = document.getElementById("cancel-dialog");
  const cancelForm = cancelDialog && cancelDialog.querySelector("[data-cancel-form]");
  document.querySelectorAll('[data-open-dialog="cancel-dialog"]').forEach(button => {
    button.addEventListener("click", () => {
      const item = button.dataset.cancelScope === "item";
      cancelForm.reset();
      Nx.clearErrors(cancelForm);
      cancelForm.elements.itemId.value = item ? button.dataset.itemId : "";
      cancelDialog.querySelector("[data-cancel-title]").textContent = item ? `Cancel ${button.dataset.itemName}?` : "Cancel this order?";
      cancelDialog.querySelector("[data-cancel-text]").textContent = page.dataset.paid === "true"
        ? "The money for this goes back to you, and the item goes back on the shelf."
        : "The items go back on the shelf and you will not be charged for them.";
      cancelDialog.showModal();
    });
  });
  if (cancelForm) {
    cancelForm.addEventListener("submit", async event => {
      event.preventDefault();
      const values = Nx.formValues(cancelForm);
      const method = cancelForm.querySelector('input[name="refundMethod"]:checked');
      const url = values.itemId
        ? `/api/orders/${orderId}/items/${encodeURIComponent(values.itemId)}/cancel`
        : `/api/orders/${orderId}/cancel`;
      const reply = await Nx.submitForm(cancelForm, {
        url,
        body: { reason: values.reason, refundMethod: method ? method.value : "wallet" },
        busyLabel: "Cancelling…"
      });
      if (reply) reloadWith(reply.message);
    });
  }

  // ---------- Return ----------
  const returnDialog = document.getElementById("return-dialog");
  const returnForm = returnDialog && returnDialog.querySelector("[data-return-form]");
  document.querySelectorAll('[data-open-dialog="return-dialog"]').forEach(button => {
    button.addEventListener("click", () => {
      returnForm.reset();
      Nx.clearErrors(returnForm);
      returnDialog.showModal();
    });
  });
  if (returnForm) {
    returnForm.addEventListener("submit", async event => {
      event.preventDefault();
      const reply = await Nx.submitForm(returnForm, { url: `/api/orders/${orderId}/return`, busyLabel: "Sending…" });
      if (reply) reloadWith(reply.message);
    });
  }
})();
