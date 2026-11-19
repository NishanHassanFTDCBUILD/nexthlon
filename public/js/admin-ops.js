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
})();
