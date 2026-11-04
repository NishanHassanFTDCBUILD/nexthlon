// Confetti drawn on a <canvas> (no library): Nx.confetti(canvas) bursts once and clears itself.
// Used on the order success page and in the payment overlay. Skipped completely when the
// visitor prefers reduced motion. The success page also shows the delivery date.
(function () {
  "use strict";

  const Nx = window.Nx || (window.Nx = {});
  const colours = ["#ff7a1a", "#ffb26b", "#0b7a4b", "#1a5fd0", "#cc0c39", "#f5a623"];

  Nx.confetti = function confetti(canvas, { keep = false } = {}) {
    if (!canvas || !canvas.getContext || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = canvas.getContext("2d");
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
    window.addEventListener("resize", size);

    const pieces = Array.from({ length: Math.min(160, Math.round(width / 6)) }, () => ({
      x: width / 2 + (Math.random() - 0.5) * width * 0.3,
      y: height * 0.35,
      vx: (Math.random() - 0.5) * 14,
      vy: -Math.random() * 14 - 4,
      size: 5 + Math.random() * 6,
      turn: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 0.3,
      colour: colours[Math.floor(Math.random() * colours.length)]
    }));

    const started = performance.now();
    const DURATION = 3500;
    function frame(now) {
      const age = now - started;
      ctx.clearRect(0, 0, width, height);
      ctx.globalAlpha = Math.max(0, 1 - Math.max(0, age - DURATION + 900) / 900);
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
      window.removeEventListener("resize", size);
      if (!keep) canvas.remove();
    }
    requestAnimationFrame(frame);
  };

  const note = document.querySelector("[data-success-delivery]");
  if (note && note.dataset.pincode) {
    Nx.api(`/api/delivery/estimate?pincode=${encodeURIComponent(note.dataset.pincode)}`)
      .then(({ estimate }) => { note.textContent = `${note.textContent} Expected delivery: ${estimate.label}.`; })
      .catch(() => { /* the address line is enough */ });
  }
  Nx.confetti(document.querySelector("[data-confetti]"));
})();
