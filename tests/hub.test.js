// Complete-the-kit bundles (E6), the content hub (E7) and marketplace listings (E8).
// Pure rules always run; the database tests use "_hub" and need TEST_MONGODB_URI.
require("./helpers");
const test = require("node:test");
const assert = require("node:assert/strict");
const marketplace = require("../services/marketplaceService");
const bundleService = require("../services/bundleService");
const guideService = require("../services/guideService");

test("marketplace feed: spreadsheet formulas are neutralised and commas are quoted", () => {
  assert.ok(marketplace.cell("=1+1").startsWith("'="), "formula starts with an apostrophe");
  assert.equal(marketplace.cell("Shoe, red"), "\"Shoe, red\"");
  assert.equal(marketplace.cell("say \"hi\""), "\"say \"\"hi\"\"\"");
});

test("marketplace feed: one row per option, with the stock of each", () => {
  const rows = marketplace.rowsFor([{
    _id: "p1", name: "Trail", brand: "Nexthlon", price: 499900, mrp: 599900, slug: "trail", image: "/x.webp", sku: "", stock: 9,
    variants: [{ _id: "v1", size: "8", colour: "Black", sku: "TF-8-BLK", stock: 3 }, { _id: "v2", size: "9", colour: "", sku: "", stock: 0 }]
  }]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].sku, "TF-8-BLK");
  assert.equal(rows[0].option, "Size 8 · Black");
  assert.equal(rows[0].availability, "in stock");
  assert.equal(rows[1].availability, "out of stock");
  const csv = marketplace.toCsv(rows);
  assert.match(csv.split("\r\n")[0], /^sku,product_id,title/);
  assert.equal(marketplace.authorised("anything"), false, "no token configured: nothing is accepted");
});

test("bundles: the set is priced from its items and the saving is the bundle's percent", () => {
  const shape = bundleService.shape({ _id: "b1", name: "Runner kit", slug: "runner-kit", percentOff: 10, products: ["a", "b"] }, [
    { _id: "a", name: "Shoe", slug: "s", price: 500000, stock: 1, variants: [] },
    { _id: "b", name: "Socks", slug: "k", price: 100000, stock: 2, variants: [] }
  ]);
  assert.equal(shape.price, 600000);
  assert.equal(shape.saving, 60000);
  assert.equal(shape.total, 540000);
  assert.equal(shape.buyable, true);
  assert.equal(bundleService.slugify("Runner Kit & Socks!"), "runner-kit-socks");
});

test("guides: paragraphs starting with ## are headings; the rest are text", () => {
  const blocks = guideService.blocks({ body: ["## Warm up", "Start slow."] });
  assert.deepEqual(blocks, [{ heading: true, text: "Warm up" }, { heading: false, text: "Start slow." }]);
});
