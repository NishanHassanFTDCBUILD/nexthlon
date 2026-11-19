// Operations: run a payment webhook event again, and retry a failed job. The server checks each
// request (services/webhookLogService.js, services/jobMonitorService.js) and audit-logs it.
(function () {
  'use strict';

  document.addEventListener('click', async (event) => {
    const rerun = event.target.closest('[data-webhook-rerun]');
    const retry = event.target.closest('[data-job-retry]');
    if (!rerun && !retry) return;

    if (rerun) {
      const ok = await Nx.confirm({
        title: 'Run this payment event again?',
        message:
          'It is handled exactly as when it first arrived. It is safe to repeat: a payment already recorded is not counted twice.',
        confirmLabel: 'Run it again',
        tone: 'primary',
      });
      if (!ok) return;
      Nx.busy(rerun, true, 'Running…');
      try {
        const reply = await Nx.api(
          `/api/admin/webhooks/${encodeURIComponent(rerun.dataset.webhookRerun)}/rerun`,
          {method: 'POST'},
        );
        Nx.flash(reply.message);
        window.location.reload();
      } catch (error) {
        Nx.busy(rerun, false);
        Nx.toast(error.message, 'error');
      }
      return;
    }

    const ok = await Nx.confirm({
      title: `Retry the ${retry.dataset.type} job?`,
      message: 'It goes back in the queue to run now, with its attempts reset.',
      confirmLabel: 'Retry the job',
      tone: 'primary',
    });
    if (!ok) return;
    Nx.busy(retry, true, 'Queuing…');
    try {
      const reply = await Nx.api(
        `/api/admin/jobs/${encodeURIComponent(retry.dataset.jobRetry)}/retry`,
        {method: 'POST'},
      );
      Nx.flash(reply.message);
      window.location.reload();
    } catch (error) {
      Nx.busy(retry, false);
      Nx.toast(error.message, 'error');
    }
  });

  // ---------- Return rules: save the automatic and owner approval limits ----------
  document.addEventListener('submit', async (event) => {
    if (!event.target.matches('[data-return-rules]')) return;
    const form = event.target;
    event.preventDefault();
    const button = form.querySelector('[type="submit"]');
    Nx.busy(button, true, 'Saving…');
    try {
      const reply = await Nx.api('/api/admin/returns/rules', {
        method: 'PATCH',
        body: {
          autoApproveRupees: form.elements.autoApproveRupees.value,
          ownerApproveRupees: form.elements.ownerApproveRupees.value,
        },
      });
      Nx.flash(reply.message);
      window.location.reload();
    } catch (error) {
      Nx.busy(button, false);
      Nx.toast(error.message, 'error');
    }
  });

  // ---------- Monthly revenue goal: save the target for the month ----------
  document.addEventListener('submit', async (event) => {
    const form = event.target.closest('[data-goal-form]');
    if (!form) return;
    event.preventDefault();
    const button = form.querySelector('[type="submit"]');
    Nx.busy(button, true, 'Saving…');
    try {
      const reply = await Nx.api(
        '/api/admin/goals/' + encodeURIComponent(form.dataset.goalForm),
        {
          method: 'PATCH',
          body: {
            amount:
              form.elements.amount.value === ''
                ? 0
                : Number(form.elements.amount.value),
          },
        },
      );
      Nx.flash(reply.message);
      window.location.reload();
    } catch (error) {
      Nx.busy(button, false);
      Nx.toast(error.message, 'error');
    }
  });
})();
