// Starts a 3D scene safely: only when its section comes near the screen, never without WebGL
// (the container then shows its CSS 3D fallback), and as one still frame for reduced motion.
//   build(canvas, { reduced, tier }) → { scene, ready? } (ready: a promise for textures etc.)
import { supportsWebGL } from "./gl.js";
import { prefersReducedMotion, deviceTier, wantsLessData } from "./interaction.js";

export function boot(container, canvas, build) {
  if (!container || !canvas) return;
  // No WebGL, or the visitor is saving data / on a very slow connection: show the still version.
  if (!supportsWebGL() || wantsLessData()) {
    container.classList.add("no-webgl");
    return;
  }
  let started = false;
  const start = async () => {
    if (started) return;
    started = true;
    try {
      const reduced = prefersReducedMotion();
      const { scene, ready } = build(canvas, { reduced, tier: deviceTier() });
      container.classList.add("has-webgl");
      if (reduced) {
        container.classList.add("is-static");
        if (ready) await ready;
        scene.render(2);
        return;
      }
      scene.start();
      requestAnimationFrame(() => container.classList.add("is-live"));
    } catch (error) {
      // A driver or shader problem: fall back to the CSS version, never a broken page.
      container.classList.remove("has-webgl");
      container.classList.add("no-webgl");
      if (window.console) console.warn("3D scene skipped:", error.message);
    }
  };
  if (!("IntersectionObserver" in window)) return start();
  const watcher = new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting)) {
      watcher.disconnect();
      start();
    }
  }, { rootMargin: "200px" });
  watcher.observe(container);
}
