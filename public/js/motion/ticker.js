// The one animation loop for the whole site. Every moving thing (WebGL scenes, the footer wave,
// the showroom, ...) subscribes here instead of running its own requestAnimationFrame loop.
//   const stop = NxTicker.add((time, dt) => { ... });   // time and dt in seconds; dt is capped at 0.05
//   NxTicker.read(fn) / NxTicker.write(fn)               // one-off jobs for the next frame:
//                                                         // all reads run before all writes
// The loop runs only while something is subscribed (or queued) and the tab is visible.
// Loaded as a classic script before everything else (window.NxTicker); Node tests require it.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory;
  else root.NxTicker = factory(root);
})(typeof self !== "undefined" ? self : this, function createTicker(env) {
  "use strict";

  const raf = env.requestAnimationFrame.bind(env);
  const caf = env.cancelAnimationFrame.bind(env);
  const doc = env.document;
  const subscribers = new Set();
  let reads = [];
  let writes = [];
  let frame = 0;
  let last = 0;
  let elapsed = 0;

  const hidden = () => Boolean(doc && doc.hidden);
  const busy = () => subscribers.size > 0 || reads.length > 0 || writes.length > 0;

  function run(fn, ...args) {
    try {
      fn(...args);
    } catch (error) {
      // One broken animation must never stop the others.
      if (env.console) env.console.error(error);
    }
  }

  function tick(now) {
    frame = 0;
    const dt = last ? Math.min(0.05, Math.max(0, (now - last) / 1000)) : 0;
    last = now;
    elapsed += dt;
    const jobs = { reads, writes };
    reads = [];
    writes = [];
    jobs.reads.forEach(fn => run(fn));
    subscribers.forEach(fn => run(fn, elapsed, dt));
    jobs.writes.forEach(fn => run(fn));
    schedule();
  }

  function schedule() {
    if (frame || hidden() || !busy()) return;
    frame = raf(tick);
  }

  function pause() {
    if (frame) caf(frame);
    frame = 0;
    last = 0; // no huge jump in dt when the tab comes back
  }

  if (doc && doc.addEventListener) {
    doc.addEventListener("visibilitychange", () => {
      if (hidden()) pause();
      else schedule();
    });
  }

  return {
    add(fn) {
      subscribers.add(fn);
      schedule();
      return () => {
        subscribers.delete(fn);
        if (!busy()) pause();
      };
    },
    read(fn) {
      reads.push(fn);
      schedule();
    },
    write(fn) {
      writes.push(fn);
      schedule();
    },
    get size() {
      return subscribers.size;
    },
    get running() {
      return frame !== 0;
    }
  };
});
