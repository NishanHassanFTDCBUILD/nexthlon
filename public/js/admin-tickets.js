// Admin: reply to a customer's help request and set its status.
(function () {
  "use strict";
  const form = document.querySelector("[data-admin-ticket-reply]");
  if (!form) return;
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const reply = await Nx.submitForm(form, { url: `/api/admin/tickets/${form.dataset.adminTicketReply}/reply`, busyLabel: "Sending…" });
    if (reply) {
      Nx.flash(reply.message);
      window.location.reload();
    }
  });
})();
