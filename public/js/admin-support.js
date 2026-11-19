// Support inbox: fill the reply box from a ready-made reply, and send the reply through the API.
(function () {
  'use strict';

  const Pages = window.NxPages;
  if (!Pages || !Pages.define) return;

  Pages.define('admin-support-ticket', (root, signal) => {
    const form = root.querySelector('[data-support-reply]');
    if (!form) return;
    const canned = form.querySelector('[data-canned]');
    const body = form.querySelector('#reply-body');
    const replies = JSON.parse(
      document.getElementById('canned-data').textContent,
    );

    canned.addEventListener(
      'change',
      () => {
        if (canned.value === '') return;
        body.value = replies[Number(canned.value)];
        body.focus();
      },
      {signal},
    );

    form.addEventListener(
      'submit',
      async (event) => {
        event.preventDefault();
        const reply = await Nx.submitForm(form, {
          url: `/api/admin/tickets/${encodeURIComponent(form.dataset.supportReply)}/reply`,
          method: 'POST',
          body: {message: body.value, status: form.elements.status.value},
          busyLabel: 'Sending…',
        });
        if (!reply) return;
        Nx.flash(reply.message || 'Reply sent to the customer.');
        window.location.reload();
      },
      {signal},
    );
  });
})();
