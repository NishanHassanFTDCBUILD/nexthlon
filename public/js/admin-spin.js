// 360 view (admin): upload the product's turning photos. The links are filled in the 360 box, in the order the
// files were chosen, and the product keeps them once the upload finishes.
(function () {
  'use strict';

  const input = document.querySelector('[data-spin-file]');
  if (!input) return;
  const status = document.querySelector('[data-spin-status]');
  const box = document.getElementById('p-spin');

  input.addEventListener('change', async () => {
    const files = Array.from(input.files || []);
    if (!files.length) return;
    const url = input.dataset.uploadUrl;
    status.textContent = 'Uploading ' + files.length + ' photos…';
    const body = new FormData();
    files.forEach((file) => body.append('frames', file));
    try {
      const response = await fetch(url, {
        method: 'POST',
        body,
        credentials: 'same-origin',
      });
      const reply = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(
          reply.message || 'The 360 photos could not be uploaded.',
        );
      box.value = (reply.spinFrames || []).join('\n');
      status.textContent = reply.message;
      Nx.toast(reply.message);
    } catch (error) {
      status.textContent = error.message;
      Nx.toast(error.message, 'error');
    } finally {
      input.value = '';
    }
  });
})();
