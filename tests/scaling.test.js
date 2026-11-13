// Scaling out (docs/SCALING.md): CDN caching only for signed-out visitors, the shared rate-limit store,
// cache clearing across copies, the order-rush limit, and the new settings checks.
// The API part uses its own database (the test database name + "_scaling") and runs only when
// TEST_MONGODB_URI is set; the rest needs no database.
process.env.PUBLIC_CACHE_SECONDS = "60";
require("./helpers");
const test = require("node:test");
const assert = require("node:assert/strict");

const { checkEnv } = require("../config/schema");
const { SharedStore } = require("../middleware/rateLimitStore");
const cacheSync = require("../services/cacheSync");
const memo = require("../utils/memo");

// ---------- Without a database ----------

test("settings: WEB_CONCURRENCY, PUBLIC_CACHE_SECONDS and REDIS_URL are checked", () => {
  const base = { MONGODB_URI: "mongodb://127.0.0.1:27017/nexthlon", JWT_SECRET: "a-long-enough-test-secret-with-many-different-characters-1234" };
  const errorsFor = extra => checkEnv({ ...base, ...extra }).errors.join(" | ");
  assert.equal(errorsFor({ WEB_CONCURRENCY: "auto", PUBLIC_CACHE_SECONDS: "60", REDIS_URL: "rediss://default:pw@redis.example.com:6380" }), "");
  assert.match(errorsFor({ WEB_CONCURRENCY: "many" }), /WEB_CONCURRENCY/);
  assert.match(errorsFor({ WEB_CONCURRENCY: "64" }), /WEB_CONCURRENCY/);
  assert.match(errorsFor({ PUBLIC_CACHE_SECONDS: "3600" }), /PUBLIC_CACHE_SECONDS/);
  assert.match(errorsFor({ REDIS_URL: "http://redis.example.com" }), /REDIS_URL/);
  const warnings = checkEnv({ ...base, WEB_CONCURRENCY: "16", MONGODB_MAX_POOL: "50" }).warnings.join(" | ");
  assert.match(warnings, /800 database connections per server/, "warns before Atlas's 500-connection limit is reached");
});

// A tiny stand-in for Redis: just what the store uses, with keys that run out.
function fakeRedis() {
  const data = new Map();
  const now = () => Date.now();
  return {
    data,
    async eval(script, { keys: [key], arguments: [ms] }) {
      let entry = data.get(key);
      if (!entry || entry.expires <= now()) entry = { hits: 0, expires: 0 };
      entry.hits += 1;
      if (entry.hits === 1) entry.expires = now() + Number(ms);
      data.set(key, entry);
      return [entry.hits, entry.expires - now()];
    },
    async decr(key) { const entry = data.get(key); if (entry) entry.hits -= 1; },
    async del(key) { data.delete(key); }
  };
}

test("rate limits: two copies of the store share one count through Redis", async () => {
  const redis = fakeRedis();
  const copyA = new SharedStore("login", { getClient: async () => redis });
  const copyB = new SharedStore("login", { getClient: async () => redis });
  copyA.init({ windowMs: 60_000 });
  copyB.init({ windowMs: 60_000 });
  await copyA.increment("1.2.3.4");
  await copyA.increment("1.2.3.4");
  const third = await copyB.increment("1.2.3.4");
  assert.equal(third.totalHits, 3, "the other copy sees the same count");
  assert.ok(third.resetTime > new Date() && third.resetTime <= new Date(Date.now() + 60_000));
  assert.ok(redis.data.has("nexthlon:rl:login:1.2.3.4"), "kept under the limiter's own name");
  await copyB.decrement("1.2.3.4");
  assert.equal((await copyA.increment("1.2.3.4")).totalHits, 3);
  await copyA.resetKey("1.2.3.4");
  assert.equal((await copyB.increment("1.2.3.4")).totalHits, 1);
});

test("rate limits: without Redis, or when it fails, each copy still counts in memory", async () => {
  const none = new SharedStore("form", { getClient: async () => null });
  none.init({ windowMs: 60_000 });
  await none.increment("ip");
  assert.equal((await none.increment("ip")).totalHits, 2);
  const broken = new SharedStore("form", { getClient: async () => ({ eval: async () => { throw new Error("down"); } }) });
  broken.init({ windowMs: 60_000 });
  assert.equal((await broken.increment("ip")).totalHits, 1, "a Redis failure never turns into a crash or a free pass");
});

test("cache sync: a clear from another copy clears here, and is not passed on again", async () => {
  memo.forget();
  let passedOn = 0;
  memo.onForget(() => { passedOn += 1; });
  await memo.remember("catalog:home", 60_000, async () => "old home");
  assert.equal(cacheSync.handleMessage(JSON.stringify({ from: "another-copy", prefix: "catalog:" })), true);
  assert.equal(await memo.remember("catalog:home", 60_000, async () => "new home"), "new home");
  assert.equal(passedOn, 0, "a clear that came from a peer is not broadcast back");
  assert.equal(cacheSync.handleMessage(JSON.stringify({ from: cacheSync.self, prefix: "catalog:" })), false, "its own message is ignored");
  assert.equal(cacheSync.handleMessage("not json"), false);
  memo.forget("catalog:");
  assert.equal(passedOn, 1, "a local clear is passed on");
});

// ---------- With a database ----------

if (!process.env.TEST_MONGODB_URI) {
  test("scaling API tests (set TEST_MONGODB_URI to run them)", { skip: true }, () => {});
  return;
}

const mongoose = require("mongoose");
const app = require("../app");
const Product = require("../models/Product");
const categoryService = require("../services/categoryService");

const dbUrl = new URL(process.env.TEST_MONGODB_URI);
dbUrl.pathname = `${dbUrl.pathname.replace(/\/$/, "")}_scaling`;
let server;
let base;

async function get(path, cookie) {
  const headers = { Accept: "text/html" };
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(base + path, { headers, redirect: "manual" });
  await response.arrayBuffer();
  return response;
}

test.before(async () => {
  if (!/test/i.test(dbUrl.pathname)) throw new Error("The scaling test database must have 'test' in its name.");
  await mongoose.connect(dbUrl.href);
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map(model => model.syncIndexes()));
  const running = await categoryService.ensureCategory("Running");
  categoryService.invalidate();
  await Product.create({ name: "Scale Trail Shoe", slug: "scale-trail-shoe", category: running._id, brand: "Nexthlon", basePrice: 299900, mrp: 399900, stock: 5, image: "/img/favicon.svg" });
  server = app.listen(0);
  await new Promise(resolve => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  await new Promise(resolve => server.close(resolve));
});

test("CDN caching: signed-out store pages may be kept by a CDN, never by the browser", async () => {
  for (const path of ["/", "/products", "/products/scale-trail-shoe", "/about"]) {
    const response = await get(path);
    assert.equal(response.status, 200, path);
    const cache = response.headers.get("cache-control");
    assert.match(cache, /public/, path);
    assert.match(cache, /s-maxage=60/, path);
    assert.match(cache, /max-age=0/, `${path}: the browser always asks again`);
    assert.match(response.headers.get("vary") || "", /Cookie/i, path);
  }
});

test("CDN caching: anyone signed in, and the cart, checkout and account pages, are never cached", async () => {
  const signedIn = await get("/", "nx_sid=some-session; nx_token=some-token");
  assert.match(signedIn.headers.get("cache-control"), /no-store/);
  assert.match(signedIn.headers.get("cache-control"), /private/);
  const expiredButSignedIn = await get("/products", "nx_sid=some-session");
  assert.match(expiredButSignedIn.headers.get("cache-control"), /no-store/, "a session label alone still means signed in");
  for (const path of ["/cart", "/login", "/checkout"]) {
    assert.match((await get(path)).headers.get("cache-control"), /no-store/, path);
  }
});

test("order rush: placing orders is limited per customer account", async () => {
  const { orderLimiter } = require("../middleware/rateLimit");
  assert.equal(typeof orderLimiter, "function");
  const signup = await fetch(`${base}/api/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", Origin: base },
    body: JSON.stringify({ name: "Rush Buyer", email: "rush@scaling.test", password: "rush2024run", confirmPassword: "rush2024run" })
  });
  const cookie = (signup.headers.get("set-cookie") || "").match(/nx_token=[^;]+/)[0];
  let last;
  for (let i = 0; i < 21; i += 1) {
    last = await fetch(`${base}/api/orders`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", Origin: base, Cookie: cookie }, body: "{}" });
  }
  assert.equal(last.status, 429, "the 21st attempt in 10 minutes is refused");
  assert.match((await last.json()).message, /Too many orders/);
});
