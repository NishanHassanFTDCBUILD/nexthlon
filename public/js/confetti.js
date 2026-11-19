// Confetti drawn on a <canvas> (no library): Nx.confetti(canvas) bursts once and clears itself.
// Used on the order success page and in the payment overlay. Skipped completely when the
// visitor prefers reduced motion. The success page also shows the delivery date.
(function () {
  'use strict';

  const Nx = window.Nx || (window.Nx = {});
  // The brand colours, read from tokens.css (with the same values as a fallback).
  const style = getComputedStyle(document.documentElement);
  const colours = [
    ['--volt', '#d4ff3a'],
    ['--volt-light', '#ecff9e'],
    ['--ivory', '#f5f5f0'],
    ['--success', '#34d399'],
    ['--info', '#60a5fa'],
    ['--deal', '#ff5a1f'],
  ].map(([name, fallback]) => style.getPropertyValue(name).trim() || fallback);

  Nx.confetti = function confetti(canvas, {keep = false} = {}) {
    if (
      !canvas ||
      !canvas.getContext ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    )
      return;
    const ctx = canvas.getContext('2d');
    // The canvas already holds a WebGL context (the 3D confetti started and then failed): skip.
    if (!ctx) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    let width = 0;
    let height = 0;
    function size() {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    }
    size();
    window.addEventListener('resize', size);

    const pieces = Array.from(
      {length: Math.min(160, Math.round(width / 6))},
      () => ({
        x: width / 2 + (Math.random() - 0.5) * width * 0.3,
        y: height * 0.35,
        vx: (Math.random() - 0.5) * 14,
        vy: -Math.random() * 14 - 4,
        size: 5 + Math.random() * 6,
        turn: Math.random() * Math.PI,
        spin: (Math.random() - 0.5) * 0.3,
        colour: colours[Math.floor(Math.random() * colours.length)],
      }),
    );

    const started = performance.now();
    const DURATION = 3500;
    function frame(now) {
      const age = now - started;
      ctx.clearRect(0, 0, width, height);
      ctx.globalAlpha = Math.max(
        0,
        1 - Math.max(0, age - DURATION + 900) / 900,
      );
      for (const p of pieces) {
        p.vy += 0.32;
        p.vx *= 0.99;
        p.x += p.vx;
        p.y += p.vy;
        p.turn += p.spin;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.turn);
        ctx.fillStyle = p.colour;
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
      }
      if (age < DURATION) {
        requestAnimationFrame(frame);
        return;
      }
      ctx.clearRect(0, 0, width, height);
      window.removeEventListener('resize', size);
      if (!keep) canvas.remove();
    }
    requestAnimationFrame(frame);
  };

  const note = document.querySelector('[data-success-delivery]');
  const eta = document.querySelector('[data-success-eta]');
  if (note && note.dataset.pincode) {
    Nx.api(
      `/api/delivery/estimate?pincode=${encodeURIComponent(note.dataset.pincode)}`,
    )
      .then(({estimate}) => {
        if (!estimate || !estimate.label) return;
        note.textContent = `${note.textContent} Expected delivery: ${estimate.label}.`;
        if (eta) eta.textContent = estimate.label;
      })
      .catch(() => {
        /* the address line is enough */
      });
  }
  // The confetti follows the tick drawing itself on the success page (motion.css), so the two
  // read as one moment instead of competing. The WebGL confetti (fx/confetti3d.js, a module on this
  // page) fires from both bottom corners and pops out of the tick; without it, the 2D confetti above.
  const canvas = document.querySelector('[data-confetti]');
  if (canvas) {
    const tick = document.querySelector('.success-draw');
    const wait = Nx.motionMs ? Nx.motionMs('--duration-slow', 400) * 2 : 800;
    setTimeout(
      () => {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches)
          return;
        const box = tick ? tick.getBoundingClientRect() : null;
        const popAt =
          box && box.width
            ? {x: box.left + box.width / 2, y: box.top + box.height / 2}
            : null;
        if (window.NxConfetti3d && window.NxConfetti3d(canvas, {popAt})) return;
        Nx.confetti(canvas);
      },
      tick ? wait : 0,
    );
  }
})();
