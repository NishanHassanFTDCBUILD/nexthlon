// Privacy (D2): consent before analytics, analytics only from the hosts it needs, shopping events
// without personal data, and "Download my data". The export test has its own database ("_privacy")
// and runs only when TEST_MONGODB_URI is set.
require("./helpers");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { readAnalytics, analyticsProblems, cspHosts } = require("../utils/analytics");
const events = require("../utils/analyticsEvents");

const read = file => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

test("privacy: analytics is off unless a provider and a valid ID are set", () => {
  assert.equal(readAnalytics({}).enabled, false);
  assert.equal(readAnalytics({ ANALYTICS_PROVIDER: "ga4", ANALYTICS_ID: "UA-1234" }).enabled, false);
  assert.deepEqual(readAnalytics({ ANALYTICS_PROVIDER: "GA4", ANALYTICS_ID: "G-AB12CD34" }), { enabled: true, provider: "ga4", id: "G-AB12CD34", host: "" });
  const plausible = readAnalytics({ ANALYTICS_PROVIDER: "plausible", ANALYTICS_ID: "nexthlon.in", PLAUSIBLE_HOST: "https://stats.example.com/" });
  assert.equal(plausible.host, "https://stats.example.com");
  assert.equal(readAnalytics({ ANALYTICS_PROVIDER: "plausible", ANALYTICS_ID: "nexthlon.in" }).host, "https://plausible.io");

  assert.deepEqual(analyticsProblems({}), []);
  assert.equal(analyticsProblems({ ANALYTICS_PROVIDER: "matomo", ANALYTICS_ID: "x" })[0][0], "ANALYTICS_PROVIDER");
  assert.equal(analyticsProblems({ ANALYTICS_PROVIDER: "ga4" })[0][0], "ANALYTICS_ID");
  assert.match(analyticsProblems({ ANALYTICS_PROVIDER: "ga4", ANALYTICS_ID: "123" })[0][1], /G-XXXXXXXXXX/);
});

test("privacy: the security policy only lets in the chosen provider's hosts", () => {
  assert.deepEqual(cspHosts(readAnalytics({})), { script: [], connect: [], img: [] });
  const ga = cspHosts(readAnalytics({ ANALYTICS_PROVIDER: "ga4", ANALYTICS_ID: "G-AB12CD34" }));
  assert.deepEqual(ga.script, ["https://www.googletagmanager.com"]);
  assert.ok(ga.connect.includes("https://*.google-analytics.com"));
  const pl = cspHosts(readAnalytics({ ANALYTICS_PROVIDER: "plausible", ANALYTICS_ID: "nexthlon.in" }));
  assert.deepEqual(pl, { script: ["https://plausible.io"], connect: ["https://plausible.io"], img: [] });
  assert.match(read("app.js"), /\.\.\.analyticsHosts\.script/);
});

test("privacy: nothing from the provider loads before the visitor says yes", () => {
  const consent = read("public/js/consent.js");
  // load() runs only from the "analytics" choice, never on its own.
  const calls = consent.split("\n").filter(line => /\bload\(\);/.test(line)).map(line => line.trim());
  assert.equal(calls.length, 2, "once for a stored yes, once when the visitor picks yes");
  assert.match(consent, /if \(choice === "analytics"\) \{\s*load\(\);/);
  assert.match(consent, /if \(value === "analytics"\) \{\s*load\(\);/);
  assert.match(consent, /read\(\) !== "analytics" \|\| !loaded\) return;/, "events before consent are dropped");
  assert.match(consent, /globalPrivacyControl === true\) write\("essential"\)/);
  const scripts = read("views/partials/scripts.ejs");
  assert.match(scripts, /analytics\.enabled/, "the banner and script only exist when analytics is set up");
  assert.match(scripts, /consent === false/, "and never on admin pages");
  assert.match(read("views/partials/admin-end.ejs"), /consent: false/);
  assert.match(scripts, /replace\(\/<\/g, '\\\\u003c'\)/, "page events cannot close the script tag");
});

test("privacy: shopping events carry products and amounts in rupees, never the shopper", () => {
  const product = { _id: "p1", name: "Match Ball", brand: "Nexthlon", price: 59900 };
  const view = events.viewItem(product);
  assert.equal(view.name, "view_item");
  assert.equal(view.params.value, 599);
  assert.deepEqual(view.params.items[0], { item_id: "p1", item_name: "Match Ball", price: 599, quantity: 1, item_brand: "Nexthlon" });

  const order = {
    orderId: "NX-1", total: 129800, deliveryFee: 0, paymentMethod: "cod",
    shippingAddress: { fullName: "Asha", phone: "9876543210" }, user: "u1",
    items: [{ product: "p1", name: "Match Ball", price: 59900, quantity: 2, option: "Size 5" }, { product: "p2", name: "Pump", price: 9900, quantity: 1, status: "cancelled" }]
  };
  const sale = events.purchase(order);
  assert.equal(sale.params.transaction_id, "NX-1");
  assert.equal(sale.params.value, 1298);
  assert.equal(sale.params.items.length, 1, "cancelled lines are not part of the sale");
  assert.equal(sale.params.items[0].item_variant, "Size 5");
  assert.equal(sale.once, "purchase:NX-1", "a reloaded thank-you page is not a second sale");
  assert.doesNotMatch(JSON.stringify(sale), /Asha|9876543210|u1/);

  const begin = events.beginCheckout({ totals: { total: 69800 }, lines: [{ productId: "p1", name: "Match Ball", price: 59900, quantity: 1 }] });
  assert.equal(begin.params.value, 698);
});

if (!process.env.TEST_MONGODB_URI) {
  test("privacy database tests (set TEST_MONGODB_URI to run them)", { skip: true }, () => {});
  return;
}

const mongoose = require("mongoose");
const app = require("../app");
const User = require("../models/User");
const Order = require("../models/Order");
const AuditLog = require("../models/AuditLog");

const dbUrl = new URL(process.env.TEST_MONGODB_URI);
dbUrl.pathname = `${dbUrl.pathname.replace(/\/$/, "")}_privacy`;
let server;
let base;

async function call(cookie, method, url, body) {
  const headers = { Accept: "application/json", Origin: base };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(base + url, { method, headers, redirect: "manual", body: body === undefined ? undefined : JSON.stringify(body) });
  const set = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  return { response, status: response.status, cookies: set.map(line => line.split(";")[0]).join("; "), text: await response.text() };
}

test.before(async () => {
  if (!/test/i.test(dbUrl.pathname)) throw new Error("The privacy test database must have 'test' in its name.");
  await mongoose.connect(dbUrl.href);
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map(model => model.syncIndexes()));
  server = app.listen(0);
  await new Promise(resolve => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  await new Promise(resolve => server.close(resolve));
});

test("privacy: a customer downloads everything kept about them, without secrets or staff notes", async () => {
  const guest = await call("", "GET", "/api/account/export");
  assert.equal(guest.status, 401);

  const signup = await call("", "POST", "/api/signup", { name: "Data Owner", email: "data.owner@privacy.test", password: "secure2024run", confirmPassword: "secure2024run" });
  assert.equal(signup.status, 201, signup.text);
  const user = await User.findOne({ email: "data.owner@privacy.test" });
  await Order.collection.insertOne({
    orderId: "NX-PRIV-1", user: user._id, items: [], total: 59900, paymentMethod: "cod", paymentStatus: "pending", orderStatus: "placed",
    notes: [{ body: "Customer sounded rude on the phone", byName: "Staff" }], createdAt: new Date()
  });

  const res = await call(signup.cookies, "GET", "/api/account/export");
  assert.equal(res.status, 200);
  assert.match(res.response.headers.get("content-disposition"), /attachment; filename="nexthlon-my-data-\d{4}-\d{2}-\d{2}\.json"/);
  assert.equal(res.response.headers.get("cache-control"), "no-store");
  const data = JSON.parse(res.text);
  assert.equal(data.account.email, "data.owner@privacy.test");
  assert.equal(data.orders.length, 1);
  assert.equal(data.orders[0].orderId, "NX-PRIV-1");
  assert.doesNotMatch(res.text, /passwordHash|tokenVersion|twoFactor|secretEnc|rude on the phone/);
  assert.ok(await AuditLog.findOne({ action: "account.data_export", target: `user:${user._id}` }), "each download is written to the audit log");
});
