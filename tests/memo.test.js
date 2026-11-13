// The short-lived catalogue cache (utils/memo.js).
const test = require("node:test");
const assert = require("node:assert/strict");
const memo = require("../utils/memo");

test("memo: a value is loaded once and reused until it runs out", async () => {
  memo.forget();
  let loads = 0;
  const load = async () => { loads += 1; return { n: loads }; };
  assert.deepEqual(await memo.remember("t:a", 50, load), { n: 1 });
  assert.deepEqual(await memo.remember("t:a", 50, load), { n: 1 });
  await new Promise(resolve => setTimeout(resolve, 70));
  assert.deepEqual(await memo.remember("t:a", 50, load), { n: 2 });
});

test("memo: many requests at once share one load (no stampede)", async () => {
  memo.forget();
  let loads = 0;
  const load = () => new Promise(resolve => setTimeout(() => { loads += 1; resolve(loads); }, 20));
  const values = await Promise.all(Array.from({ length: 25 }, () => memo.remember("t:b", 1000, load)));
  assert.equal(loads, 1);
  assert.ok(values.every(value => value === 1));
});

test("memo: clearing a group drops it, and a load already running does not put an old value back", async () => {
  memo.forget();
  let version = 1;
  // Each load returns the data as it was when the load started.
  const slow = () => { const seen = version; return new Promise(resolve => setTimeout(() => resolve(seen), 30)); };
  const running = memo.remember("catalog:home", 1000, slow);
  memo.remember("other:x", 1000, async () => "kept");
  memo.forget("catalog:");
  version = 2;
  assert.equal(await running, 1, "the waiting request still gets its answer");
  assert.equal(await memo.remember("catalog:home", 1000, slow), 2, "the next request loads fresh data");
  assert.equal(await memo.remember("other:x", 1000, async () => "reloaded"), "kept", "other groups are untouched");
});

test("memo: a failed load is not kept, so the next request tries again", async () => {
  memo.forget();
  await assert.rejects(memo.remember("t:c", 1000, async () => { throw new Error("database down"); }));
  assert.equal(await memo.remember("t:c", 1000, async () => "ok"), "ok");
});
