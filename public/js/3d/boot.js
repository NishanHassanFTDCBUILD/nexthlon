// Starts a 3D scene safely: only when its section comes near the screen, never without WebGL
// (the container then shows its CSS 3D fallback), and as one still frame for reduced motion.
//   build(canvas, { reduced, tier }) → { scene, ready? } (ready: a promise for textures etc.)
import {supportsWebGL} from './gl.js';
import {
  prefersReducedMotion,
  deviceTier,
  wantsLessData,
} from './interaction.js';

export function boot(container, canvas, build) {
  if (!container || !canvas) return;
  // The visitor is saving data or on a very slow connection: show the still version.
  if (wantsLessData()) {
    container.classList.add('no-webgl');
    return;
  }
  let started = false;
  const start = async () => {
    if (started) return;
    started = true;
    // No WebGL: the still version stays. (Checked here, not on load: the check itself creates a GL context.)
    if (!supportsWebGL()) {
      container.classList.add('no-webgl');
      return;
    }
    try {
      const reduced = prefersReducedMotion();
      const {scene, ready} = build(canvas, {reduced, tier: deviceTier()});
      container.classList.add('has-webgl');
      if (reduced) {
        container.classList.add('is-static');
        if (ready) await ready;
        scene.render(2);
        return;
      }
      scene.start();
      requestAnimationFrame(() => container.classList.add('is-live'));
    } catch (error) {
      // A driver or shader problem: fall back to the CSS version, never a broken page.
      container.classList.remove('has-webgl');
      container.classList.add('no-webgl');
      if (window.console) console.warn('3D scene skipped:', error.message);
    }
  };
  // The scene starts right after the page's first paint, without waiting for every image to load:
  // the text and buttons are already on screen, and the CSS version fades into the 3D one.
  // On phones it gets a short idle window first (at most 300 ms), so a tap in that moment still answers.
  const touch =
    window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  const whenIdle = (run) => {
    const go = () =>
      requestAnimationFrame(() => {
        if (touch && 'requestIdleCallback' in window)
          window.requestIdleCallback(run, {timeout: 300});
        else setTimeout(run, 0);
      });
    if (document.readyState === 'loading')
      document.addEventListener('DOMContentLoaded', go, {once: true});
    else go();
  };
  if (!('IntersectionObserver' in window)) return whenIdle(start);
  const watcher = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        watcher.disconnect();
        whenIdle(start);
      }
    },
    {rootMargin: '200px'},
  );
  watcher.observe(container);
}
