// The footer floor: a perspective grid of dots that rolls like a slow wave, drawn on a 2D canvas
// (the page's single WebGL canvas is kept for its main scene). It runs only while the footer is
// on screen and the tab is visible, and draws one still frame for reduced motion.
(function () {
  "use strict";

  const canvas = document.querySelector("[data-footer-wave]");
  if (!canvas || !canvas.getContext || !("IntersectionObserver" in window)) return;
  const ctx = canvas.getContext("2d");
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const COLS = window.innerWidth < 720 ? 28 : 46;
  const ROWS = 16;
  let width = 0;
  let height = 0;
  let running = false;
  let frame = 0;
  let onScreen = false;

  function size() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  // Projects a point on the floor (x across, z away from the viewer, y = wave height).
  function draw(time) {
    ctx.clearRect(0, 0, width, height);
    const horizon = height * 0.05;
    for (let row = 0; row < ROWS; row += 1) {
      const z = 1 + row * 0.55;
      for (let col = 0; col < COLS; col += 1) {
        const x = (col / (COLS - 1) - 0.5) * 2.6;
        const wave = Math.sin(x * 2.4 + time * 0.9) * 0.18 + Math.cos(z * 0.9 - time * 0.7) * 0.22;
        const px = width / 2 + (x * width * 0.62) / z;
        const py = horizon + (height - horizon) * (1 - row / ROWS) + (wave * height * 0.18) / z;
        const glow = Math.max(0, wave + 0.35);
        ctx.globalAlpha = Math.min(1, (0.12 + glow * 0.55) * (1 - row / ROWS));
        ctx.fillStyle = glow > 0.38 ? "#d4ff3a" : "#8f9a6a";
        const r = Math.max(0.6, (2.2 / z) * (0.7 + glow));
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  function loop(now) {
    if (!running) return;
    draw(now / 1000);
    frame = requestAnimationFrame(loop);
  }

  function sync() {
    const go = onScreen && !document.hidden && !reduced;
    if (go && !running) {
      running = true;
      frame = requestAnimationFrame(loop);
    } else if (!go && running) {
      running = false;
      cancelAnimationFrame(frame);
    }
  }

  new IntersectionObserver(entries => {
    onScreen = entries.some(entry => entry.isIntersecting);
    if (onScreen && !width) {
      size();
      draw(0);
    }
    sync();
  }).observe(canvas);
  document.addEventListener("visibilitychange", sync);
  window.addEventListener("resize", () => {
    if (!width) return;
    size();
    draw(performance.now() / 1000);
  });
})();
