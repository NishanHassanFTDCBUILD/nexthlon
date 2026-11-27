// Initialized by the product form for both full loads and admin navigation.
(function () {
  'use strict';
  window.NxProductMedia = (root, signal) => {
    const input = root.querySelector('[data-video-file]');
    if (!input) return;
    const link = root.querySelector('#p-video');
    const preview = root.querySelector('[data-video-preview]');
    const status = root.querySelector('[data-video-status]');
    link.type = 'text';
    let objectUrl;
    const update = () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      const file = input.files[0];
      input.setCustomValidity(
        file && file.size > 25 * 1024 * 1024
          ? 'Choose an MP4 or WebM video up to 25 MB.'
          : '',
      );
      objectUrl = file ? URL.createObjectURL(file) : null;
      const src = objectUrl || link.value.trim();
      preview.hidden = !src;
      if (src) preview.src = src;
      else preview.removeAttribute('src');
      status.textContent = file
        ? file.name + ' — ready to upload when you save.'
        : 'MP4 or WebM, up to 25 MB. Appears alongside product photos.';
    };
    input.addEventListener('change', update, {signal});
    link.addEventListener('change', update, {signal});
    update();
    signal.addEventListener('abort', () => {
      preview.pause();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    });
  };
})();
