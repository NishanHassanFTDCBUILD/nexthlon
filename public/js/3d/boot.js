// Starts a 3D scene safely: only when its section comes near the screen, never without WebGL
// (the container then shows its CSS 3D fallback), and as one still frame for reduced motion.
//   build(canvas, { reduced, tier }) → { scene, ready? } (ready: a promise for textures etc.)
import { supportsWebGL } from "./gl.js";
import { prefersReducedMotion, deviceTier, wantsLessData } from "./interaction.js";

export function boot(container, canvas, build) {
  if (!container || !canvas) return;
  // The visitor is saving data or on a very slow connection: show the still version.
  if (wantsLessData()) {
    container.classList.add("no-webgl");
    return;
  }
  let started = false;
  const start = async () => {
    if (started) return;
    started = true;
    // No WebGL: the still version stays. (Checked here, not on load: the check itself creates a GL context.)
    if (!supportsWebGL()) {
      container.classList.add("no-webgl");
      return;
    }
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
  // Building a scene compiles shaders and uploads textures: long tasks. They wait until the page has
  // loaded and the browser is idle, so the first paint and the first tap are never held up by 3D.
  // The CSS version shows meanwhile.
  // On a phone that setup is most of a second of work, so it waits for a sign the visitor is staying:
  // their first scroll or touch, or four seconds after the page loaded. The first screen is ready to
  // use straight away, and the scene (which reacts to scrolling anyway) is in place by the time it moves.
  const touch = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
  const whenIdle = run => {
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      ["scroll", "pointerdown", "keydown"].forEach(type => window.removeEventListener(type, go));
      "requestIdleCallback" in window ? window.requestIdleCallback(run, { timeout: 1500 }) : setTimeout(run, 400);
    };
    const afterLoad = () => {
      if (!touch) return go();
      ["scroll", "pointerdown", "keydown"].forEach(type => window.addEventListener(type, go, { once: true, passive: true }));
      setTimeout(go, 4000);
    };
    if (document.readyState === "complete") afterLoad();
    else window.addEventListener("load", afterLoad, { once: true });
  };
  if (!("IntersectionObserver" in window)) return whenIdle(start);
  const watcher = new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting)) {
      watcher.disconnect();
      whenIdle(start);
    }
  }, { rootMargin: "200px" });
  watcher.observe(container);
}
