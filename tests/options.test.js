// Sizes and colours (B3): each option has its own stock, the product's stock is their sum, a size must be
// chosen to buy, two sizes are two cart lines, and orders, cancels and Buy now take and give back stock on
// the chosen size only, atomically.
// Own database (the test database name + "_options"); runs only when TEST_MONGODB_URI is set.
require("./helpers");
const test = require("node:test");
const assert = require("node:assert/strict");
const { readProductOptions, validateProduct } = require("../utils/validators");
const { optionLabel, lineKey, readLineKey } = require("../utils/options");

test("options: labels and line keys", () => {
  assert.equal(optionLabel({ size: "9", colour: "Red" }), "Size 9 · Red");
  assert.equal(optionLabel({ size: "", colour: "Blue" }), "Blue");
  assert.equal(optionLabel(null), "");
  const p = "a".repeat(24);
  const o = "b".repeat(24);
  assert.equal(lineKey(p, o), `${p}-${o}`);
  assert.equal(lineKey(p, null), p);
  assert.deepEqual(readLineKey(`${p}-${o}`), { productId: p, optionId: o });
  assert.deepEqual(readLineKey(p), { productId: p, optionId: null });
  assert.equal(readLineKey("nope"), null);
});

test("options: the admin's rows are checked", () => {
  assert.deepEqual(readProductOptions("").list, []);
  assert.equal(readProductOptions("[{").error.includes("could not be read"), true);
  assert.match(readProductOptions([{ size: "", colour: "", stock: 1 }]).error, /size, a colour, or both/);
  assert.match(readProductOptions([{ size: "9", stock: -1 }]).error, /whole number/);
  assert.match(readProductOptions([{ size: "9", stock: 1 }, { size: "9", stock: 2 }]).error, /same as an earlier row/);
  assert.match(readProductOptions([{ size: "9", stock: 1 }, { colour: "Red", stock: 2 }]).error, /every row a size/);
  const ok = readProductOptions(JSON.stringify([{ size: "9", colour: "Red", sku: "X-9", stock: "3" }, { size: "10", colour: "Red", stock: 2 }]));
  assert.equal(ok.error, undefined);
  assert.deepEqual(ok.list.map(o => o.stock), [3, 2]);

  // With options, the stock field is ignored and becomes their total.
  const body = { name: "Option Shoe", category: "c".repeat(24), price: "1000", mrp: "1200", stock: "", options: JSON.stringify([{ size: "8", stock: 4 }, { size: "9", stock: 6 }]) };
  const { errors, value } = validateProduct(body);
  assert.deepEqual(errors, {});
  assert.equal(value.stock, 10);
  // Without the options field (an older form), options are left as they are.
  assert.equal(validateProduct({ ...body, options: undefined, stock: "5" }).value.variants, undefined);
});

test("options: sizes sort the way people expect", () => {
  const { sizeOrder } = require("../services/productService");
  assert.deepEqual(["10", "XL", "8.5", "S", "6", "M", "One size", "XXL", "9"].sort(sizeOrder), ["6", "8.5", "9", "10", "S", "M", "XL", "XXL", "One size"]);
});

test("options: size and colour filters ask for one option that has both, in stock", () => {
  const { readFilters, toProductQuery } = require("../services/productService");
  const query = toProductQuery(readFilters({ size: ["9", "10"], colour: "Black" }));
  assert.deepEqual(query.variants, { $elemMatch: { stock: { $gt: 0 }, size: { $in: ["9", "10"] }, colour: { $in: ["Black"] } } });
  assert.equal(toProductQuery(readFilters({})).variants, undefined, "no filter, no condition");
});

test("options: each photo's colour is read in screen order and kept only for real colours", () => {
  const { readPhotoColours, colourPhotosFor } = require("../services/adminProductService");
  assert.deepEqual(readPhotoColours(undefined, 2), { colours: null });
  assert.ok(readPhotoColours('["Black"]', 2).error, "one colour per photo");
  assert.ok(readPhotoColours("[1, 2]", 2).error);
  const { colours } = readPhotoColours('["Black", "", "volt", "Pink"]', 4);
  const plan = { keep: ["/a.webp", "/b.webp"], order: ["/a.webp", "new:0", "/b.webp", "new:1"] };
  const pairs = colourPhotosFor(plan, ["/n0.webp", "/n1.webp"], colours, ["Black", "Volt"]);
  assert.deepEqual(pairs, [{ image: "/a.webp", colour: "Black" }, { image: "/b.webp", colour: "Volt" }], "the colour's own spelling is used; Pink is not a colour of this product");
});

if (!process.env.TEST_MONGODB_URI) {
  test("option database tests (set TEST_MONGODB_URI to run them)", { skip: true }, () => {});
  return;
}

const mongoose = require("mongoose");
const app = require("../app");
const Product = require("../models/Product");
const Order = require("../models/Order");
const categoryService = require("../services/categoryService");
const stockService = require("../services/stockService");

const dbUrl = new URL(process.env.TEST_MONGODB_URI);
dbUrl.pathname = `${dbUrl.pathname.replace(/\/$/, "")}_options`;

let server;
let base;
let shoe;
let plain;
let shopper;
let addressId;

function jar() {
  const cookies = new Map();
  return {
    header: () => [...cookies].map(([name, value]) => `${name}=${value}`).join("; "),
    take(response) {
      const all = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [response.headers.get("set-cookie") || ""];
      all.filter(Boolean).forEach(line => {
        const [pair, ...attrs] = line.split(";");
        const at = pair.indexOf("=");
        const name = pair.slice(0, at).trim();
        const value = pair.slice(at + 1).trim();
        if (attrs.some(a => /expires=thu, 01 jan 1970/i.test(a)) || value === "") cookies.delete(name);
        else cookies.set(name, value);
      });
    }
  };
}

async function call(cookies, method, path, body) {
  const headers = { Accept: "application/json", Origin: base };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const cookie = cookies.header();
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(base + path, { method, headers, redirect: "manual", body: body === undefined ? undefined : JSON.stringify(body) });
  cookies.take(response);
  const type = response.headers.get("content-type") || "";
  return { status: response.status, data: type.includes("json") ? await response.json() : await response.text() };
}

const size = (product, name) => product.variants.find(v => v.size === name);
const fresh = () => Product.findById(shoe._id).lean();

test.before(async () => {
  if (!/test/i.test(dbUrl.pathname)) throw new Error("The options test database must have 'test' in its name.");
  await mongoose.connect(dbUrl.href);
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map(model => model.syncIndexes()));
  const running = await categoryService.ensureCategory("Running");
  categoryService.invalidate();
  shoe = await Product.create({
    name: "Option Trail Shoe", slug: "option-trail-shoe", category: running._id, brand: "Nexthlon", basePrice: 99900, mrp: 129900, stock: 0, image: "/img/favicon.svg",
    variants: [{ size: "8", sku: "OTS-8", stock: 3 }, { size: "9", sku: "OTS-9", stock: 1 }, { size: "10", sku: "OTS-10", stock: 0 }]
  });
  plain = await Product.create({ name: "Option Plain Socks", slug: "option-plain-socks", category: running._id, brand: "Nexthlon", basePrice: 49900, mrp: 59900, stock: 9, image: "/img/favicon.svg" });
  server = app.listen(0);
  await new Promise(resolve => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  shopper = jar();
  const signup = await call(shopper, "POST", "/api/signup", { name: "Size Shopper", email: "size.shopper@options.test", password: "sizes2024run", confirmPassword: "sizes2024run" });
  assert.equal(signup.status, 201, JSON.stringify(signup.data));
  const address = await call(shopper, "POST", "/api/addresses", { fullName: "Size Shopper", phone: "9876543210", line1: "12 MG Road", city: "Kochi", state: "Kerala", pincode: "682001" });
  assert.equal(address.status, 201, JSON.stringify(address.data));
  addressId = (address.data.address || address.data.addresses[0]).id || (address.data.address || address.data.addresses[0])._id;
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  await new Promise(resolve => server.close(resolve));
});

test("options: the product's stock is the sum of its sizes", async () => {
  assert.equal((await fresh()).stock, 4);
  const page = await call(jar(), "GET", `/products/${shoe.slug}`);
  assert.match(page.data, /data-options-json/);
  assert.match(page.data, /class="pdx-opt is-sold"[\s\S]*?value="10" disabled/, "a sold-out size is crossed out and cannot be chosen");
});

test("options: a size must be chosen; two sizes are two cart lines with their own limits", async () => {
  const none = await call(shopper, "POST", "/api/cart/items", { productId: String(shoe._id), quantity: 1 });
  assert.equal(none.status, 400);
  assert.equal(none.data.code, "option_required");

  const s8 = String(size(shoe, "8")._id);
  const s9 = String(size(shoe, "9")._id);
  const s10 = String(size(shoe, "10")._id);
  assert.equal((await call(shopper, "POST", "/api/cart/items", { productId: String(shoe._id), variantId: s10, quantity: 1 })).status, 400, "a sold-out size cannot be added");
  assert.equal((await call(shopper, "POST", "/api/cart/items", { productId: String(shoe._id), variantId: "f".repeat(24), quantity: 1 })).status, 400, "an unknown size cannot be added");

  const a = await call(shopper, "POST", "/api/cart/items", { productId: String(shoe._id), variantId: s8, quantity: 2 });
  assert.equal(a.status, 201, JSON.stringify(a.data));
  assert.match(a.data.message, /\(Size 8\) added/);
  const b = await call(shopper, "POST", "/api/cart/items", { productId: String(shoe._id), variantId: s9, quantity: 1 });
  assert.equal(b.status, 201, JSON.stringify(b.data));
  const lines = b.data.cart.items.filter(item => item.productId === String(shoe._id));
  assert.equal(lines.length, 2);
  assert.deepEqual(lines.map(l => l.option).sort(), ["Size 8", "Size 9"]);
  assert.equal(lines.find(l => l.variantId === s8).key, `${shoe._id}-${s8}`);

  // Size 9 has one left: no room for a second.
  const more = await call(shopper, "POST", "/api/cart/items", { productId: String(shoe._id), variantId: s9, quantity: 1 });
  assert.equal(more.status, 400);

  // The line key changes only that size.
  const changed = await call(shopper, "PATCH", `/api/cart/items/${shoe._id}-${s8}`, { quantity: 3 });
  assert.equal(changed.status, 200, JSON.stringify(changed.data));
  assert.equal(changed.data.cart.items.find(l => l.variantId === s8).quantity, 3);
  assert.equal(changed.data.cart.items.find(l => l.variantId === s9).quantity, 1);
  assert.equal((await call(shopper, "PATCH", `/api/cart/items/${shoe._id}-${s8}`, { quantity: 4 })).status, 400, "size 8 has only 3");

  // A product without sizes works as before.
  assert.equal((await call(shopper, "POST", "/api/cart/items", { productId: String(plain._id), quantity: 1 })).status, 201);
});

test("options: the order keeps the size, takes stock from it, and a cancel gives it back to the same size", async () => {
  const res = await call(shopper, "POST", "/api/orders", { addressId, paymentMethod: "cod" });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  const order = await Order.findOne({ orderId: res.data.order.orderId }).lean();
  const eight = order.items.find(i => i.option === "Size 8");
  assert.ok(eight, "the option label is kept on the order");
  assert.equal(eight.sku, "OTS-8");
  assert.equal(String(eight.variant), String(size(shoe, "8")._id));

  let now = await fresh();
  assert.equal(size(now, "8").stock, 0);
  assert.equal(size(now, "9").stock, 0);
  assert.equal(now.stock, 0, "the total follows the sizes");

  const cartAfter = await call(shopper, "GET", "/api/cart");
  assert.equal(cartAfter.data.cart.items.length, 0, "the bought lines leave the cart");

  const line = res.data.order.items.find(i => i.option === "Size 8");
  const cancel = await call(shopper, "POST", `/api/orders/${order.orderId}/items/${line.id}/cancel`, { reason: "Wrong size" });
  assert.equal(cancel.status, 200, JSON.stringify(cancel.data));
  now = await fresh();
  assert.equal(size(now, "8").stock, 3, "back to size 8");
  assert.equal(size(now, "9").stock, 0, "size 9 untouched");
  assert.equal(now.stock, 3);
});

test("options: Buy now needs a size and keeps it", async () => {
  const none = await call(shopper, "POST", "/api/buy-now", { productId: String(shoe._id), quantity: 1 });
  assert.equal(none.status, 400);
  assert.equal(none.data.code, "option_required");
  const s8 = String(size(shoe, "8")._id);
  const ok = await call(shopper, "POST", "/api/buy-now", { productId: String(shoe._id), variantId: s8, quantity: 1 });
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
  const placed = await call(shopper, "POST", "/api/orders", { addressId, paymentMethod: "cod", source: "buynow" });
  assert.equal(placed.status, 201, JSON.stringify(placed.data));
  const order = await Order.findOne({ orderId: placed.data.order.orderId }).lean();
  assert.equal(order.items.length, 1);
  assert.equal(order.items[0].option, "Size 8");
  assert.equal(String(order.items[0].variant), s8);
  assert.equal(size(await fresh(), "8").stock, 2, "taken from size 8");
});

test("options: listings filter by size and colour, and offer only sizes in stock", async () => {
  const productService = require("../services/productService");
  await Product.updateOne({ _id: shoe._id, "variants.size": "10" }, { $set: { "variants.$.stock": 0 } });
  await Product.updateOne({ _id: shoe._id }, [{ $set: { stock: { $sum: "$variants.stock" } } }]);
  const all = await productService.listProducts({});
  const sizes = all.facets.sizes.map(s => s.name);
  assert.ok(!sizes.includes("10"), "a sold-out size is not offered");
  assert.deepEqual(sizes, [...sizes].sort(productService.sizeOrder));

  const nine = size(await fresh(), "9");
  const eight = size(await fresh(), "8");
  const wanted = nine.stock > 0 ? "9" : eight.stock > 0 ? "8" : null;
  if (wanted) {
    const found = await productService.listProducts({ size: wanted });
    assert.deepEqual(found.products.map(p => p.slug), [shoe.slug], "only the shoe comes in a size");
  }
  const none = await productService.listProducts({ size: "10" });
  assert.equal(none.products.length, 0, "nothing is offered in a sold-out size");

  const page = await call(jar(), "GET", "/products?size=10");
  assert.equal(page.status, 200);
  assert.match(page.data, /aria-label="Remove filter: Size 10"/);
});

test("options: the product page offers the size guide and tags photos by colour", async () => {
  await Product.updateOne({ _id: shoe._id }, { $set: {
    gallery: ["/img/favicon.svg", "/img/logo.svg"],
    colourPhotos: [{ image: "/img/logo.svg", colour: "Black" }]
  } });
  const page = await call(jar(), "GET", `/products/${shoe.slug}`);
  assert.match(page.data, /data-dialog-open="size-guide"/);
  assert.match(page.data, /<dialog class="size-guide" id="size-guide"/);
  assert.match(page.data, /<tr class="is-ours"><th scope="row">8<span class="sr-only"> \(available\)/, "the shoe's own sizes are marked");
  assert.match(page.data, /class="thumb pdx-thumb" data-colour="Black"/);
});

test("options: inventory changes one size at a time and the total follows", async () => {
  const inventoryService = require("../services/inventoryService");
  const s8 = String(size(shoe, "8")._id);
  await assert.rejects(inventoryService.adjustStock(shoe._id, { action: "add", units: 2 }), /Choose which size/);

  let start = await fresh();
  const added = await inventoryService.adjustStock(String(shoe._id), { action: "add", units: 4, optionId: s8 });
  assert.equal(added.after - added.before, 4);
  let now = await fresh();
  assert.equal(size(now, "8").stock, size(start, "8").stock + 4);
  assert.equal(now.stock, now.variants.reduce((sum, v) => sum + v.stock, 0));

  await assert.rejects(inventoryService.adjustStock(String(shoe._id), { action: "remove", units: 999, optionId: s8 }), /only has/);

  const counted = await inventoryService.adjustStock(String(shoe._id), { action: "count", units: 7, optionId: s8 });
  assert.equal(counted.after, 7);
  now = await fresh();
  assert.equal(size(now, "8").stock, 7);
  assert.equal(now.stock, now.variants.reduce((sum, v) => sum + v.stock, 0), "the total is still the sum");
  assert.ok(counted.product.options.some(o => o.id === s8 && o.stock === 7), "the row shows each size");
});

test("options: two buyers for the last pair of a size: exactly one gets it", async () => {
  await Product.updateOne({ _id: shoe._id, "variants.size": "10" }, { $set: { "variants.$.stock": 1 }, $inc: { stock: 1 } });
  const s10 = size(shoe, "10")._id;
  const line = { product: shoe._id, variant: s10, quantity: 1, name: "Option Trail Shoe (Size 10)" };
  const results = await Promise.allSettled([stockService.takeStock([line]), stockService.takeStock([line])]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  const now = await fresh();
  assert.equal(size(now, "10").stock, 0, "never below zero");
  // Returning stock to a size goes to that size and the total.
  await stockService.returnStock([line]);
  const back = await fresh();
  assert.equal(size(back, "10").stock, 1);
  assert.equal(back.stock, back.variants.reduce((sum, v) => sum + v.stock, 0), "the total is still the sum of the sizes");
});
