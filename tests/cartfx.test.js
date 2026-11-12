// The WebGL effects in public/js/fx: the fly-to-cart sparks (cartfx.js) and the order-success confetti
// (confetti3d.js). Their physics run in Node without a browser, and loading the modules without a
// window must not try to draw anything.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { pathToFileURL } = require("url");

const load = () => import(pathToFileURL(path.join(__dirname, "..", "public", "js", "fx", "cartfx.js")).href);

test("cart sparks: loading the module without a browser draws nothing and sets nothing up", async () => {
  const fx = await load();
  assert.equal(typeof fx.ParticlePool, "function");
  assert.equal(typeof fx.createCartFx, "function");
  assert.equal(typeof globalThis.NxCartFx, "undefined");
});

test("cart sparks: the pool never grows past its size, and a full pool skips extra sparks", async () => {
  const { ParticlePool } = await load();
  const pool = new ParticlePool(3);
  assert.equal(pool.capacity, 3);
  assert.equal(pool.spawn(0, 0, 0, 0), true);
  assert.equal(pool.spawn(0, 0, 0, 0), true);
  assert.equal(pool.spawn(0, 0, 0, 0), true);
  assert.equal(pool.spawn(0, 0, 0, 0), false);
  assert.equal(pool.count, 3);
});

test("cart sparks: particles move, slow down, fall, and die at the end of their life", async () => {
  const { ParticlePool } = await load();
  const pool = new ParticlePool(4);
  pool.spawn(10, 10, 100, 0, { life: 1, drag: 2 });
  pool.spawn(0, 0, 0, 0, { life: 0.2, gravity: 100 });
  pool.update(0.1);
  const [moving, falling] = pool.items;
  assert.ok(moving.x > 10 && moving.x < 20, "moves less than its full speed because of drag");
  assert.ok(moving.vx < 100, "drag slows it");
  assert.ok(falling.vy > 0 && falling.y > 0, "gravity pulls down the screen (+y)");
  pool.update(0.15);
  assert.equal(pool.count, 1, "the short-lived spark is gone");
  assert.equal(pool.items[0], moving, "the live spark stays in the live range");
  pool.update(1);
  assert.equal(pool.count, 0);
});

test("cart sparks: written sparks shrink and fade over their life", async () => {
  const { ParticlePool } = await load();
  const pool = new ParticlePool(2);
  pool.spawn(5, 6, 0, 0, { life: 1, size: 10, alpha: 1, mix: 0.5 });
  const out = new Float32Array(10);
  assert.equal(pool.write(out), 1);
  assert.deepEqual([...out.slice(0, 5)], [5, 6, 10, 1, 0.5]);
  pool.update(0.5);
  pool.write(out);
  assert.ok(out[2] < 10 && out[2] > 3.5, "smaller at half its life");
  assert.ok(out[3] < 0.5, "fainter at half its life (fades with the square of the time left)");
  // The output buffer limits how many are written.
  pool.spawn(0, 0, 0, 0);
  assert.equal(pool.write(new Float32Array(5)), 1);
});

const loadConfetti = () => import(pathToFileURL(path.join(__dirname, "..", "public", "js", "fx", "confetti3d.js")).href);

test("order confetti: loading the module without a browser sets nothing up", async () => {
  const confetti = await loadConfetti();
  assert.equal(typeof confetti.celebrate, "function");
  assert.equal(typeof globalThis.NxConfetti3d, "undefined");
});

test("order confetti: strips fire up from both bottom corners and pop out of the tick", async () => {
  const { makePieces } = await loadConfetti();
  let seed = 1;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pieces = makePieces(100, 1000, 800, { popX: 500, popY: 250, colors: 6, rand });
  assert.equal(pieces.length, 100);
  const left = pieces.filter(p => p.x < 100);
  const right = pieces.filter(p => p.x > 900);
  const pop = pieces.filter(p => p.x === 500 && p.y === 250);
  assert.equal(left.length, 40);
  assert.equal(right.length, 40);
  assert.equal(pop.length, 20);
  assert.ok(left.every(p => p.vy < 0 && p.vx > 0), "the left cannon fires up and to the right");
  assert.ok(right.every(p => p.vy < 0 && p.vx < 0), "the right cannon fires up and to the left");
  assert.ok(pieces.every(p => p.color >= 0 && p.color < 6));
});

test("order confetti: strips slow down, fall, and flutter no faster than paper falls", async () => {
  const { makePieces, stepPieces } = await loadConfetti();
  const pieces = makePieces(10, 1000, 800);
  for (let i = 0; i < 300; i += 1) stepPieces(pieces, 1 / 60, i / 60);
  assert.ok(pieces.every(p => p.vy > 0 && p.vy <= 240), "after five seconds every strip is falling, slowly");
  assert.ok(pieces.every(p => Math.abs(p.vx) < 5), "the cannon speed has worn off");
});
