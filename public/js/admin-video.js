// Product video (admin): upload an MP4 or WebM file for this product. The link in the form is filled in with the
// stored address, and the product keeps it once the form is saved.
(function () {
  'use strict';

  const input = document.querySelector('[data-video-file]');
  if (!input) return;
  const status = document.querySelector('[data-video-status]');
  const link = document.getElementById('p-video');

  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    const url = input.dataset.uploadUrl;
    status.textContent = 'Uploading…';
    const body = new FormData();
    body.append('video', file);
    try {
      const response = await fetch(url, {
        method: 'POST',
        body,
        credentials: 'same-origin',
      });
      const reply = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(reply.message || 'The video could not be uploaded.');
      link.value = reply.videoUrl;
      status.textContent = 'Uploaded. The video is set on this product.';
      Nx.toast(reply.message);
    } catch (error) {
      status.textContent = error.message;
      Nx.toast(error.message, 'error');
    } finally {
      input.value = '';
    }
  });
})();
