// Inventory tools: sales pace, bulk changes and the Undo data.
// Own database ("_inventory_tools"); runs only when TEST_MONGODB_URI is set (the pure rules run always).
require("./helpers");
const test = require("node:test");
const assert = require("node:assert/strict");
const inventoryService = require("../services/inventoryService");

test("inventory: days left come from the last 30 days of sales; no sales means no estimate", () => {
  assert.equal(inventoryService.daysLeft(30, 30), 30, "one a day, 30 on the shelf");
  assert.equal(inventoryService.daysLeft(5, 60), 2);
  assert.equal(inventoryService.daysLeft(10, 0), null);
});

if (!process.env.TEST_MONGODB_URI) {
  test("inventory tools database tests (set TEST_MONGODB_URI to run them)", { skip: true }, () => {});
  return;
}

const mongoose = require("mongoose");
const app = require("../app");
const User = require("../models/User");
const Product = require("../models/Product");
const Order = require("../models/Order");
const categoryService = require("../services/categoryService");
const { hashPassword } = require("../services/authService");

const dbUrl = new URL(process.env.TEST_MONGODB_URI);
dbUrl.pathname = `${dbUrl.pathname.replace(/\/$/, "")}_inventory_tools`;
let server;
let base;
let cookie;
let ball;
let shoe;

async function call(method, url, body, type = "json") {
  const headers = { Accept: "application/json", Origin: base, Cookie: cookie || "" };
  if (body !== undefined) headers["Content-Type"] = type === "csv" ? "text/csv" : "application/json";
  const res = await fetch(base + url, { method, headers, body: body === undefined ? undefined : type === "csv" ? body : JSON.stringify(body) });
  const set = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  return { status: res.status, cookies: set.map(line => line.split(";")[0]).join("; "), data: await res.json().catch(() => ({})) };
}

test.before(async () => {
  if (!/test/i.test(dbUrl.pathname)) throw new Error("The test database must have 'test' in its name.");
  await mongoose.connect(dbUrl.href);
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map(model => model.syncIndexes()));
  const football = await categoryService.ensureCategory("Football");
  categoryService.invalidate();
  ball = await Product.create({ name: "Tools Ball", slug: "tools-ball", category: football._id, brand: "Nexthlon", basePrice: 50000, mrp: 60000, stock: 30, sku: "BALL-5", image: "/img/favicon.svg" });
  shoe = await Product.create({ name: "Tools Shoe", slug: "tools-shoe", category: football._id, brand: "Nexthlon", basePrice: 300000, mrp: 350000, stock: 4, image: "/img/favicon.svg",
    variants: [{ size: "8", sku: "SHOE-8", stock: 3 }, { size: "9", sku: "SHOE-9", stock: 1 }] });
  const buyer = await User.create({ name: "Tools Buyer", email: "buyer@tools.test", passwordHash: "x".repeat(60) });
  // 15 balls sold in the last 30 days (cash on delivery), and 50 in a cancelled order that must not count.
  const order = extra => Order.create({
    orderId: `NX-T-${Math.random().toString(36).slice(2, 8)}`, user: buyer._id,
    items: [{ product: ball._id, name: "Tools Ball", slug: "tools-ball", price: 50000, mrp: 60000, quantity: extra.quantity, lineTotal: 50000 * extra.quantity, status: extra.status || "delivered" }],
    address: { fullName: "Tools Buyer", phone: "9876543210", line1: "1 Road", city: "Kochi", state: "Kerala", pincode: "682001" },
    mrpTotal: 1, subtotal: 1, total: 1, paymentMethod: "cod", paymentStatus: "paid", orderStatus: extra.orderStatus || "delivered"
  });
  await order({ quantity: 15 });
  await order({ quantity: 50, status: "cancelled", orderStatus: "cancelled" });
  await User.create({ name: "Tools Admin", email: "admin@tools.test", passwordHash: await hashPassword("AdminPass123"), role: "admin" });
  server = app.listen(0);
  await new Promise(resolve => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  cookie = (await call("POST", "/api/admin/login", { email: "admin@tools.test", password: "AdminPass123" })).cookies;
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  await new Promise(resolve => server.close(resolve));
});

test("inventory: the list shows units sold in 30 days and the days left at that pace", async () => {
  const res = await call("GET", "/api/admin/inventory?q=Tools%20Ball");
  assert.equal(res.status, 200, JSON.stringify(res.data));
  const row = res.data.products.find(p => p.name === "Tools Ball");
  assert.equal(row.sold30, 15, "the cancelled order does not count");
  assert.equal(row.daysLeft, 60, "30 on the shelf at half a ball a day");
});

test("inventory: a change replies with before and after, so the page can offer Undo", async () => {
  const res = await call("PATCH", `/api/admin/inventory/${ball._id}`, { action: "add", units: 10 });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(res.data.before, 30);
  assert.equal(res.data.after, 40);
  await call("PATCH", `/api/admin/inventory/${ball._id}`, { action: "remove", units: 10, note: "Undo" });
});

test("inventory: bulk changes skip products with sizes and change the rest", async () => {
  const res = await call("POST", "/api/admin/inventory/bulk", { productIds: [String(ball._id), String(shoe._id)], action: "add", units: 5 });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(res.data.products.length, 1);
  assert.equal(res.data.products[0].stock, 35);
  assert.equal(res.data.skipped.length, 1);
  assert.match(res.data.skipped[0].reason, /sizes or colours/);
  assert.equal((await call("POST", "/api/admin/inventory/bulk", { productIds: [], action: "add", units: 1 })).status, 400);
});
