// 360 spin: a product photo turns as the shopper drags it sideways, or with the arrow keys.
// The frames come from the product page (data-frames). They load only once the shopper touches it.
(function () {
  'use strict';

  const PIXELS_PER_FRAME = 12;

  function init(box) {
    const frames = (box.dataset.frames || '').split(' ').filter(Boolean);
    const img = box.querySelector('[data-spin-frame]');
    if (frames.length < 2 || !img) return;

    let index = 0;
    let startX = null;
    let startIndex = 0;

    const show = (i) => {
      index = ((i % frames.length) + frames.length) % frames.length;
      img.src = frames[index];
    };

    box.addEventListener(
      'pointerdown',
      () => {
        frames.forEach((src) => {
          const preload = new Image();
          preload.src = src;
        });
      },
      {once: true},
    );

    box.addEventListener('pointerdown', (event) => {
      startX = event.clientX;
      startIndex = index;
      if (box.setPointerCapture) box.setPointerCapture(event.pointerId);
    });
    box.addEventListener('pointermove', (event) => {
      if (startX === null) return;
      const steps = Math.round((event.clientX - startX) / PIXELS_PER_FRAME);
      if (steps !== 0) show(startIndex + steps);
    });
    const finish = () => {
      startX = null;
    };
    box.addEventListener('pointerup', finish);
    box.addEventListener('pointercancel', finish);

    box.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        show(index + 1);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        show(index - 1);
      }
    });
  }

  document.querySelectorAll('[data-spin]').forEach(init);
})();
