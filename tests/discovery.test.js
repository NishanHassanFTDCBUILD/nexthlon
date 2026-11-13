// Finding products: "frequently bought together" from real orders, search that forgives spelling
// mistakes, and the short-lived catalogue cache being cleared when a product changes.
// Own database (the test database name + "_discovery"); runs only when TEST_MONGODB_URI is set.
require("./helpers");
const test = require("node:test");
const assert = require("node:assert/strict");

if (!process.env.TEST_MONGODB_URI) {
  test("discovery tests (set TEST_MONGODB_URI to run them)", { skip: true }, () => {});
  return;
}

const mongoose = require("mongoose");
const Product = require("../models/Product");
const Order = require("../models/Order");
const User = require("../models/User");
const categoryService = require("../services/categoryService");
const productService = require("../services/productService");
const homeService = require("../services/homeService");
const recommendations = require("../services/recommendationService");
const memo = require("../utils/memo");

const dbUrl = new URL(process.env.TEST_MONGODB_URI);
dbUrl.pathname = `${dbUrl.pathname.replace(/\/$/, "")}_discovery`;

let shoes;
let socks;
let bottle;
let tent;
let hidden;
let buyer;

async function order(items, status = "delivered", daysAgo = 3) {
  const lines = items.map(product => ({ product: product._id, name: product.name, slug: product.slug, image: product.image, price: product.price, mrp: product.mrp, quantity: 1, lineTotal: product.price, status }));
  const total = lines.reduce((sum, line) => sum + line.lineTotal, 0);
  const created = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  const doc = await Order.create({
    orderId: `NX-T-${new mongoose.Types.ObjectId()}`, user: buyer._id, items: lines,
    address: { fullName: "Test Buyer", phone: "9876543210", line1: "1 Test Road", city: "Pune", state: "Maharashtra", pincode: "411001" },
    mrpTotal: total, subtotal: total, total, paymentMethod: "cod", paymentStatus: "paid", orderStatus: status
  });
  await Order.collection.updateOne({ _id: doc._id }, { $set: { createdAt: created } });
}

test.before(async () => {
  if (!/test/i.test(dbUrl.pathname)) throw new Error("The discovery test database must have 'test' in its name.");
  await mongoose.connect(dbUrl.href);
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map(model => model.syncIndexes()));
  const running = await categoryService.ensureCategory("Running");
  const outdoor = await categoryService.ensureCategory("Outdoor");
  categoryService.invalidate();
  const make = (name, slug, category, extra = {}) => Product.create({ name, slug, category: category._id, brand: "Nexthlon", basePrice: 99900, mrp: 149900, stock: 10, image: "/img/favicon.svg", ...extra });
  shoes = await make("Velocity Running Shoes", "velocity-running-shoes", running);
  socks = await make("Cushioned Running Socks", "cushioned-running-socks", running);
  bottle = await make("Outdoor Performance Bottle", "outdoor-performance-bottle", outdoor);
  tent = await make("Expedition Tent", "expedition-tent", outdoor);
  hidden = await make("Retired Trail Cap", "retired-trail-cap", running, { isListed: false });
  buyer = await User.create({ name: "Test Buyer", email: "buyer@discovery.test", passwordHash: "x".repeat(60), role: "customer" });

  // Shoes were bought with socks three times and with the bottle once. Old, cancelled and returned
  // orders, and the unlisted cap, must not count.
  await order([shoes, socks]);
  await order([shoes, socks, bottle]);
  await order([shoes, socks]);
  await order([shoes, tent], "delivered", 400);
  await order([shoes, tent], "cancelled");
  await order([shoes, tent], "returned");
  await order([shoes, hidden]);
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

test("bought together: most often first, only recent counted orders, only listed in-stock products", async () => {
  memo.forget();
  const together = await recommendations.boughtTogether(shoes._id, 4);
  assert.deepEqual(together.map(entry => entry.product.slug), ["cushioned-running-socks", "outdoor-performance-bottle"]);
  assert.deepEqual(together.map(entry => entry.orders), [3, 1]);
  assert.deepEqual(await recommendations.boughtTogether(tent._id, 4), [], "only old, cancelled or returned orders: nothing");
  assert.deepEqual(await recommendations.boughtTogether("not-an-id"), []);
});

test("bought together: a product that sells out drops off at once (the cache is cleared)", async () => {
  memo.forget();
  assert.equal((await recommendations.boughtTogether(shoes._id, 4)).length, 2);
  await Product.updateOne({ _id: bottle._id }, { $set: { stock: 0 } });
  assert.deepEqual((await recommendations.boughtTogether(shoes._id, 4)).map(entry => entry.product.slug), ["cushioned-running-socks"]);
  await Product.updateOne({ _id: bottle._id }, { $set: { stock: 10 } });
});

test("customers also bought, for a cart: suggestions for what is in it, minus what is already there", async () => {
  memo.forget();
  const suggestions = await recommendations.forCart([String(shoes._id), String(socks._id)], 4);
  assert.deepEqual(suggestions.map(p => p.slug), ["outdoor-performance-bottle"]);
});

test("search: a misspelt word finds what was meant, and says so; a correct word is left alone", async () => {
  memo.forget();
  const corrected = await productService.listProducts({ q: "shoees" });
  assert.equal(corrected.searchMode, "corrected");
  assert.equal(corrected.correctedQuery, "shoes");
  assert.deepEqual(corrected.products.map(p => p.slug), ["velocity-running-shoes"]);

  const twoWords = await productService.listProducts({ q: "runing sokcs" });
  assert.equal(twoWords.correctedQuery, "running socks");
  assert.equal(twoWords.products[0].slug, "cushioned-running-socks");

  const exact = await productService.listProducts({ q: "shoes" });
  assert.equal(exact.searchMode, "text");
  assert.equal(exact.correctedQuery, null);

  const nothing = await productService.listProducts({ q: "qwzxv" });
  assert.equal(nothing.products.length, 0);
  assert.equal(nothing.correctedQuery, null);
});

test("home page cache: built once, shared, and rebuilt straight after a product changes", async () => {
  memo.forget();
  const first = await homeService.getHomePage();
  const second = await homeService.getHomePage();
  assert.equal(first.newest, second.newest, "the same cached sections");
  await Product.create({ name: "Brand New Racket", slug: "brand-new-racket", category: shoes.category, brand: "Nexthlon", basePrice: 199900, mrp: 249900, stock: 3, image: "/img/favicon.svg" });
  const third = await homeService.getHomePage();
  assert.equal(third.newest[0].slug, "brand-new-racket", "a new product shows on the next request");
  assert.ok(third.dealEndsAt > Date.now(), "the deal countdown is worked out fresh on every request");
});

// ---------- The search panel before typing (searchInsightService) ----------
const searchInsights = require("../services/searchInsightService");
const SearchLog = require("../models/SearchLog");

test("search log: words are cleaned up, and only the words, a day and a count are kept", async () => {
  assert.equal(searchInsights.normalizeTerm("  Running   SHOES!! "), "running shoes");
  assert.equal(searchInsights.normalizeTerm("a"), "", "too short");
  assert.equal(searchInsights.normalizeTerm("<script>alert(1)</script>"), "script alert 1 script");
  await SearchLog.deleteMany({});
  await searchInsights.record("Running Shoes", 2);
  await searchInsights.record("running shoes", 2);
  const [row] = await SearchLog.find({}).lean();
  assert.equal(row.term, "running shoes");
  assert.equal(row.count, 2);
  assert.deepEqual(Object.keys(row).sort(), ["_id", "count", "day", "results", "term"], "nothing about who searched");
});

test("trending searches: only store words that found products, searched more than once, last 7 days", async () => {
  memo.forget();
  await SearchLog.deleteMany({});
  const today = searchInsights.startOfDay();
  const daysAgo = n => new Date(today.getTime() - n * 24 * 60 * 60 * 1000);
  await SearchLog.insertMany([
    { term: "running socks", day: today, count: 9, results: 1 },
    { term: "running shoes", day: daysAgo(2), count: 5, results: 1 },
    { term: "buy cheap stuff now", day: today, count: 50, results: 3 },  // not the store's words
    { term: "tent", day: today, count: 40, results: 0 },                 // found nothing
    { term: "velocity", day: today, count: 1, results: 1 },              // only once
    { term: "expedition tent", day: daysAgo(20), count: 30, results: 1 } // too old
  ]);
  const terms = (await searchInsights.trending(8)).map(entry => entry.term);
  assert.deepEqual(terms, ["running socks", "running shoes"]);
});

test("search panel: trending searches, sports to jump to, and popular products", async () => {
  memo.forget();
  const panel = await searchInsights.startPanel();
  assert.deepEqual(panel.searches, [{ term: "running socks", trending: true }, { term: "running shoes", trending: true }]);
  assert.deepEqual(panel.sports.map(sport => sport.slug).sort(), ["outdoor", "running"]);
  assert.ok(panel.products.length > 0 && panel.products.length <= 4);
  assert.ok(panel.products.every(p => p.slug && p.name && typeof p.price === "number"), "public product fields only");
});

test("search panel: with no searches yet, no trending group (the sports would only be repeated)", async () => {
  memo.forget();
  await SearchLog.deleteMany({});
  const panel = await searchInsights.startPanel();
  assert.deepEqual(panel.searches, []);
  assert.ok(panel.sports.length > 0 && panel.products.length > 0);
});
