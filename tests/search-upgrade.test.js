// Search upgrade (E4): synonyms, and as-you-type suggestions. The synonym rules run always;
// the suggestion endpoint test needs TEST_MONGODB_URI (own database "_search").
require("./helpers");
const test = require("node:test");
const assert = require("node:assert/strict");
const { expandQuery } = require("../utils/synonyms");

test("search: a synonym finds the store's own words, and plain words are left alone", () => {
  assert.equal(expandQuery("sneakers"), "sneakers shoes");
  assert.equal(expandQuery("soccer boots"), "soccer boots football");
  assert.equal(expandQuery("trail shoes"), "trail shoes");
  assert.equal(expandQuery("sneakers shoes"), "sneakers shoes", "no duplicate words");
  assert.ok(expandQuery("bottle sneakers soccer bike tent weights racquet rucksack gloves jersey trainers").split(" ").length <= 25);
});

if (!process.env.TEST_MONGODB_URI) {
  test("search database tests (set TEST_MONGODB_URI to run them)", { skip: true }, () => {});
  return;
}

const mongoose = require("mongoose");
const app = require("../app");
const Product = require("../models/Product");
const categoryService = require("../services/categoryService");

const dbUrl = new URL(process.env.TEST_MONGODB_URI);
dbUrl.pathname = `${dbUrl.pathname.replace(/\/$/, "")}_search`;
let server;
let base;

test.before(async () => {
  if (!/test/i.test(dbUrl.pathname)) throw new Error("The search test database must have 'test' in its name.");
  await mongoose.connect(dbUrl.href);
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map(model => model.syncIndexes()));
  const football = await categoryService.ensureCategory("Football");
  categoryService.invalidate();
  await Product.create({ name: "Trail Running Shoes", slug: "trail-shoes", category: football._id, brand: "Nexthlon", basePrice: 499900, mrp: 599900, stock: 5, image: "/img/favicon.svg" });
  await Product.create({ name: "Pro Match Football", slug: "pro-football", category: football._id, brand: "Nexthlon", basePrice: 199900, mrp: 249900, stock: 5, image: "/img/favicon.svg" });
  server = app.listen(0);
  await new Promise(resolve => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  await new Promise(resolve => server.close(resolve));
});

test("search: suggestions start with what is typed, and a synonym finds the product", async () => {
  const sug = await fetch(`${base}/api/products/suggest?q=tra`).then(r => r.json());
  assert.deepEqual(sug.suggestions.map(s => s.label), ["Trail Running Shoes"]);
  assert.deepEqual((await fetch(`${base}/api/products/suggest?q=t`).then(r => r.json())).suggestions, [], "one letter: nothing");
  assert.deepEqual((await fetch(`${base}/api/products/suggest?q=${encodeURIComponent("<script>")}`).then(r => r.json())).suggestions, []);
  const found = await fetch(`${base}/api/products?q=sneakers`).then(r => r.json());
  assert.ok(found.products.some(p => p.name === "Trail Running Shoes"), "sneakers finds shoes");
});
