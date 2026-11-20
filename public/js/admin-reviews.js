// Admin Reviews: hide a review with a reason, or show it again. The server checks the change and
// the product rating is updated there (services/adminReviewService.js).
(function () {
  'use strict';

  document.addEventListener('click', async (event) => {
    const hide = event.target.closest('[data-review-hide]');
    const show = event.target.closest('[data-review-show]');
    if (!hide && !show) return;
    const id = (hide || show).dataset.reviewHide || show.dataset.reviewShow;
    let body;
    if (hide) {
      const row = hide.closest('[data-review-row]');
      const reason = row.querySelector('[data-review-reason]').value;
      const ok = await Nx.confirm({
        title: 'Hide this review?',
        message: `It leaves the product page and the average rating at once. Reason: ${reason}.`,
        confirmLabel: 'Hide review',
        tone: 'danger',
      });
      if (!ok) return;
      body = {hidden: true, reason};
    } else {
      const ok = await Nx.confirm({
        title: 'Show this review again?',
        message:
          'It goes back on the product page and into the average rating.',
        confirmLabel: 'Show review',
        tone: 'primary',
      });
      if (!ok) return;
      body = {hidden: false};
    }
    const button = hide || show;
    Nx.busy(button, true, 'Saving…');
    try {
      const reply = await Nx.api(
        `/api/admin/reviews/${encodeURIComponent(id)}/hidden`,
        {
          method: 'PATCH',
          body,
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
