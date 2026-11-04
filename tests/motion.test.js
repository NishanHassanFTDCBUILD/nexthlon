// The shared animation ticker (public/js/motion/ticker.js), driven by a fake requestAnimationFrame.
const test = require("node:test");
const assert = require("node:assert/strict");
const createTicker = require("../public/js/motion/ticker.js");

function fakeEnv() {
  const listeners = {};
  const env = {
    queue: new Map(),
    nextId: 1,
    console: { error() {} },
    document: { hidden: false, addEventListener: (name, fn) => { listeners[name] = fn; } },
    requestAnimationFrame(fn) {
      const id = env.nextId++;
      env.queue.set(id, fn);
      return id;
    },
    cancelAnimationFrame(id) { env.queue.delete(id); },
    // Runs every queued frame callback at time `now` (ms).
    frame(now) {
      const jobs = [...env.queue.values()];
      env.queue.clear();
      jobs.forEach(fn => fn(now));
    },
    setHidden(hidden) {
      env.document.hidden = hidden;
      listeners.visibilitychange();
    }
  };
  return env;
}

test("ticker: one loop for every subscriber, with time and a capped dt; idle when nobody listens", () => {
  const env = fakeEnv();
  const ticker = createTicker(env);
  assert.equal(ticker.running, false);
  const a = [];
  const b = [];
  const stopA = ticker.add((time, dt) => a.push(dt));
  ticker.add((time, dt) => b.push(time));
  // Two subscribers still share a single frame request.
  assert.equal(env.queue.size, 1);
  env.frame(1000);
  env.frame(1016);
  env.frame(3000); // a long gap (a slow frame) is capped at 0.05s
  assert.deepEqual(a.map(dt => Math.round(dt * 1000)), [0, 16, 50]);
  assert.equal(b.length, 3);
  assert.ok(Math.abs(b[2] - 0.066) < 1e-9);
  stopA();
  env.frame(3016);
  assert.equal(a.length, 3);
  assert.equal(b.length, 4);
});

test("ticker: stops when the last subscriber leaves, and pauses in hidden tabs", () => {
  const env = fakeEnv();
  const ticker = createTicker(env);
  const stop = ticker.add(() => {});
  assert.equal(ticker.running, true);
  env.setHidden(true);
  assert.equal(ticker.running, false);
  assert.equal(env.queue.size, 0);
  env.setHidden(false);
  assert.equal(ticker.running, true);
  stop();
  assert.equal(ticker.running, false);
  assert.equal(env.queue.size, 0);
});

test("ticker: reads run before writes in the next frame, once; one failing job never stops the rest", () => {
  const env = fakeEnv();
  const ticker = createTicker(env);
  const order = [];
  ticker.write(() => order.push("write"));
  ticker.read(() => order.push("read"));
  ticker.add(() => { throw new Error("broken animation"); });
  ticker.add(() => order.push("tick"));
  env.frame(10);
  env.frame(26);
  assert.deepEqual(order, ["read", "tick", "write", "tick"]);
});
