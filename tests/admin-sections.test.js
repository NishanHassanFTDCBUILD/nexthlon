// The trimmed admin console: Analytics, Inventory, the removed Reviews and Q&A sections,
// Coupons (admin side and the rules the store applies), and System status.
require("./helpers");
const test = require("node:test");
const assert = require("node:assert/strict");

if (!process.env.TEST_MONGODB_URI) {
  test("admin section tests (set TEST_MONGODB_URI to run them)", { skip: true }, () => {});
  return;
}

const mongoose = require("mongoose");
const app = require("../app");
const User = require("../models/User");
const Product = require("../models/Product");
const Order = require("../models/Order");
const Coupon = require("../models/Coupon");
const CouponRedemption = require("../models/CouponRedemption");
const AuditLog = require("../models/AuditLog");
const categoryService = require("../services/categoryService");
const { hashPassword } = require("../services/authService");

const dbUrl = new URL(process.env.TEST_MONGODB_URI);
dbUrl.pathname = `${dbUrl.pathname.replace(/\/$/, "")}_sections`;
const ADMIN = "/admin";

let server;
let base;
let adminCookie;
let asha;
let ashaCookie;
let ravi;
let raviCookie;
let shoe;
let socks;

async function call(method, path, { body, cookie } = {}) {
  const headers = { Accept: "application/json,text/html", Origin: base };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(base + path, { method, headers, redirect: "manual", body: body === undefined ? undefined : JSON.stringify(body) });
  const setCookie = response.headers.get("set-cookie") || "";
  const match = setCookie.match(/(nx_token|nx_admin)=([^;]*)/);
  const type = response.headers.get("content-type") || "";
  const data = type.includes("json") ? await response.json() : await response.text();
  return { status: response.status, data, headers: response.headers, location: response.headers.get("location"), cookie: match && match[2] ? `${match[1]}=${match[2]}` : null };
}

let seq = 0;
// A delivered order, which is what makes a customer able to review the product.
async function makeOrder(user, product, fields = {}) {
  seq += 1;
  const quantity = fields.quantity || 1;
  const lineTotal = product.price * quantity;
  return Order.create({
    orderId: `NX-2026-${String(500000 + seq)}`,
    user: user._id,
    items: [{ product: product._id, name: product.name, slug: product.slug, price: product.price, mrp: product.mrp, quantity, lineTotal, status: fields.itemStatus || fields.orderStatus || "delivered" }],
    address: { fullName: "Asha Nair", phone: "9876543210", line1: "1 Beach Road", city: fields.city || "Kochi", state: "Kerala", pincode: "682001" },
    mrpTotal: product.mrp * quantity,
    subtotal: lineTotal,
    total: fields.total ?? lineTotal,
    couponCode: fields.couponCode || "",
    couponDiscount: fields.couponDiscount || 0,
    paymentMethod: fields.paymentMethod || "cod",
    paymentStatus: fields.paymentStatus || "paid",
    orderStatus: fields.orderStatus || "delivered",
    deliveredAt: fields.deliveredAt || new Date(),
    stockReserved: true,
    statusHistory: []
  });
}

test.before(async () => {
  if (!/test/i.test(dbUrl.pathname)) throw new Error("The test database must have 'test' in its name.");
  await mongoose.connect(dbUrl.href);
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map(model => model.syncIndexes()));
  await User.create({ name: "Section Admin", email: "admin@sections.test", passwordHash: await hashPassword("AdminPass123"), role: "admin" });
  const running = await categoryService.ensureCategory("Running");
  categoryService.invalidate();
  shoe = await Product.create({ name: "Section Trail Shoe", slug: "section-trail-shoe", category: running._id, brand: "Nexthlon", basePrice: 300000, mrp: 400000, stock: 10, image: "/img/favicon.svg" });
  socks = await Product.create({ name: "Section Socks", slug: "section-socks", category: running._id, brand: "Nexthlon", basePrice: 50000, mrp: 60000, stock: 3, image: "/img/favicon.svg" });
  server = app.listen(0);
  await new Promise(resolve => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  ashaCookie = (await call("POST", "/api/signup", { body: { name: "Asha Nair", email: "asha@sections.test", password: "trail2024", confirmPassword: "trail2024" } })).cookie;
  raviCookie = (await call("POST", "/api/signup", { body: { name: "Ravi Menon", email: "ravi@sections.test", password: "trail2024", confirmPassword: "trail2024" } })).cookie;
  asha = await User.findOne({ email: "asha@sections.test" });
  ravi = await User.findOne({ email: "ravi@sections.test" });
  adminCookie = (await call("POST", "/api/admin/login", { body: { email: "admin@sections.test", password: "AdminPass123" } })).cookie;
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  await new Promise(resolve => server.close(resolve));
});

// ======================= Analytics =======================

test("analytics: totals, the series behind each chart, and the carts-to-orders funnel", async () => {
  await makeOrder(asha, shoe, { paymentMethod: "razorpay", quantity: 2 });
  await makeOrder(ravi, socks, { paymentMethod: "cod", paymentStatus: "pending", orderStatus: "placed", itemStatus: "placed" });

  assert.equal((await call("GET", "/api/admin/analytics")).status, 401);
  assert.equal((await call("GET", "/api/admin/analytics", { cookie: ashaCookie })).status, 401);

  const res = await call("GET", "/api/admin/analytics?range=30d", { cookie: adminCookie });
  assert.equal(res.status, 200);
  const data = res.data;

  // Everything the section promises is in the answer.
  const cards = Object.fromEntries(data.cards.map(c => [c.key, c.value]));
  assert.deepEqual(Object.keys(cards).sort(), ["aov", "buyers", "cartToOrder", "customers", "newCustomers", "orders", "revenue", "units"].filter(k => k !== "customers").sort());
  assert.equal(cards.orders, 2);
  // Only the paid order counts as revenue: 2 shoes at the selling price.
  assert.equal(cards.revenue, shoe.price * 2);
  assert.equal(cards.aov, shoe.price * 2);
  assert.equal(cards.units, 3);
  assert.equal(cards.buyers, 2);

  assert.ok(data.timeline.length > 0);
  assert.equal(data.timeline.reduce((sum, p) => sum + p.orders, 0), 2);
  assert.ok(data.newReturning.length > 0);
  assert.equal(data.newReturning.reduce((sum, p) => sum + p.newCustomers, 0), 2);

  assert.deepEqual(data.topProducts.byRevenue.map(p => p.name), ["Section Trail Shoe", "Section Socks"]);
  assert.deepEqual(data.topProducts.byUnits.map(p => p.units), [2, 1]);
  assert.deepEqual(data.topCategories.map(c => c.name), ["Running"]);

  // The payment split covers Razorpay, wallet and COD.
  const methods = Object.fromEntries(data.payments.map(p => [p.key, p.count]));
  assert.equal(methods.razorpay, 1);
  assert.equal(methods.cod, 1);
  assert.equal(data.payments.reduce((sum, p) => sum + p.share, 0), 100);

  // Conversion: orders against shoppers who filled a basket.
  assert.equal(data.funnel.orders, 2);
  assert.equal(data.funnel.paid, 1);
  assert.equal(typeof data.funnel.cartToOrder, "number");
});

test("analytics: the grouping can be day, week or month, and silly values fall back", async () => {
  const group = async query => (await call("GET", `/api/admin/analytics?${query}`, { cookie: adminCookie })).data.group;
  assert.equal((await group("range=30d&by=day")).unit, "day");
  assert.equal((await group("range=30d&by=week")).unit, "week");
  assert.equal((await group("range=year&by=month")).unit, "month");
  // A week needs at least a week of range, so "today" ignores it.
  assert.equal((await group("range=today&by=week")).key, "auto");
  // Junk is ignored rather than trusted.
  assert.equal((await group("range=30d&by=%24ne")).key, "auto");

  const weekly = await call("GET", "/api/admin/analytics?range=30d&by=week", { cookie: adminCookie });
  // A week bucket is labelled with the range it covers.
  assert.match(weekly.data.timeline[0].label, / – /);
});

test("analytics: the page renders and the CSV holds every block", async () => {
  const page = await call("GET", `${ADMIN}/analytics?range=30d&by=week`, { cookie: adminCookie });
  assert.equal(page.status, 200);
  assert.match(page.data, /data-analytics=/);
  assert.match(page.data, /data-chart="timeline"/);
  assert.match(page.data, /data-chart="payments"/);
  assert.match(page.data, /data-chart="newReturning"/);
  assert.match(page.data, /data-chart="categories"/);
  assert.match(page.data, /Carts → orders|Carts &#8594; orders/);
  // No chart library, and no inline script (the CSP forbids one).
  assert.doesNotMatch(page.data, /chart\.js|cdn\./i);
  assert.doesNotMatch(page.data, /<script>[^<]/);

  assert.equal((await call("GET", "/api/admin/reports/analytics.csv")).status, 401);
  const csv = await call("GET", "/api/admin/reports/analytics.csv?range=30d", { cookie: adminCookie });
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get("content-type"), /text\/csv/);
  assert.match(csv.headers.get("content-disposition"), /attachment; filename="nexthlon-analytics-/);
  for (const heading of ["Totals", "Revenue and orders over time", "New vs returning customers",
    "Top products by revenue", "Top products by units", "Top categories", "Payment methods", "Conversion (carts to orders)"]) {
    assert.ok(csv.data.includes(heading), `the CSV should have a "${heading}" block`);
  }
  assert.ok(csv.data.includes("Section Trail Shoe"));
});

// ======================= Inventory =======================

test("inventory: bands, filters, stock value and the CSV export", async () => {
  assert.equal((await call("GET", "/api/admin/inventory")).status, 401);
  const all = await call("GET", "/api/admin/inventory", { cookie: adminCookie });
  assert.equal(all.status, 200);
  assert.equal(all.data.pagination.total, 2);
  // Lowest stock first by default, so what needs attention is at the top.
  assert.deepEqual(all.data.products.map(p => p.name), ["Section Socks", "Section Trail Shoe"]);
  assert.equal(all.data.products[0].state, "low");
  assert.equal(all.data.products[0].stockValue, socks.price * 3);
  assert.equal(all.data.totals.units, 13);
  assert.equal(all.data.totals.value, shoe.price * 10 + socks.price * 3);
  assert.equal(all.data.totals.low, 1);
  assert.equal(all.data.totals.out, 0);

  const by = async query => (await call("GET", `/api/admin/inventory?${query}`, { cookie: adminCookie })).data.products.map(p => p.name);
  assert.deepEqual(await by("status=low"), ["Section Socks"]);
  assert.deepEqual(await by("status=healthy"), ["Section Trail Shoe"]);
  assert.deepEqual(await by("q=socks"), ["Section Socks"]);
  assert.deepEqual(await by("sort=stock_desc"), ["Section Trail Shoe", "Section Socks"]);
  assert.deepEqual(await by("sort=value_desc"), ["Section Trail Shoe", "Section Socks"]);
  assert.equal((await by("status=%24ne&sort=%7B%7D")).length, 2); // junk filters are ignored

  const page = await call("GET", `${ADMIN}/inventory?status=low`, { cookie: adminCookie });
  assert.equal(page.status, 200);
  assert.match(page.data, /data-inv-form="/);
  assert.match(page.data, /Section Socks/);

  const csv = await call("GET", "/api/admin/inventory/export.csv", { cookie: adminCookie });
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get("content-type"), /text\/csv/);
  assert.ok(csv.data.includes("Stock value (Rs)"));
  assert.ok(csv.data.includes("Section Socks"));
});

test("inventory: add, remove and set the exact count, and stock can never go negative", async () => {
  const change = (id, body) => call("PATCH", `/api/admin/inventory/${id}`, { body, cookie: adminCookie });

  const added = await change(socks._id, { action: "add", units: 7 });
  assert.equal(added.status, 200);
  assert.equal(added.data.product.stock, 10);
  assert.match(added.data.message, /up 7/);

  const removed = await change(socks._id, { action: "remove", units: 4 });
  assert.equal(removed.data.product.stock, 6);

  // Taking more than there is would make the shelf negative, so it is refused.
  const tooMany = await change(socks._id, { action: "remove", units: 99 });
  assert.equal(tooMany.status, 400);
  assert.match(tooMany.data.message, /only has 6 in stock/);
  assert.equal((await Product.findById(socks._id).lean()).stock, 6);

  // Setting the count replaces the number (after counting the shelf).
  const counted = await change(socks._id, { action: "count", units: 3, note: "Shelf count" });
  assert.equal(counted.data.product.stock, 3);
  assert.equal(counted.data.product.state, "low");

  // Validation and the audit trail.
  assert.equal((await change(socks._id, { action: "zap", units: 1 })).status, 400);
  assert.equal((await change(socks._id, { action: "add", units: 0 })).status, 400);
  assert.equal((await change(socks._id, { action: "add", units: "x" })).status, 400);
  assert.equal((await change("not-an-id", { action: "add", units: 1 })).status, 404);
  assert.equal((await call("PATCH", `/api/admin/inventory/${socks._id}`, { body: { action: "add", units: 1 }, cookie: ashaCookie })).status, 401);

  const logged = await AuditLog.findOne({ action: "inventory.stock_changed", target: `product:${socks._id}` }).sort({ at: -1 }).lean();
  assert.ok(logged, "a stock change should be written to the audit log");
  assert.equal(logged.after.action, "count");
  assert.equal(logged.after.note, "Shelf count");
  // Undo the one extra unit so later tests see the stock they expect.
  await change(socks._id, { action: "add", units: 0 }).catch(() => {});
});

test("inventory: a product with sizes is changed one size at a time, on the page, the API and the CSV", async () => {
  const sized = await Product.create({
    name: "Section Sized Spike", slug: "section-sized-spike", category: socks.category, brand: "Nexthlon", basePrice: 199900, mrp: 249900, stock: 0, image: "/img/favicon.svg", isListed: false,
    variants: [{ size: "8", sku: "SPK-8", stock: 2 }, { size: "9", sku: "SPK-9", stock: 0 }]
  });
  const s9 = String(sized.variants[1]._id);
  const change = body => call("PATCH", `/api/admin/inventory/${sized._id}`, { body, cookie: adminCookie });

  const page = await call("GET", `${ADMIN}/inventory?q=Sized`, { cookie: adminCookie });
  assert.equal(page.status, 200);
  // Each size has its own number field, holding its stock.
  assert.match(page.data, /value="0" data-stock="0" data-option-id="[a-f0-9]{24}" data-inv-field aria-label="Stock of [^"]*Size 9"/);

  const edit = await call("GET", `${ADMIN}/products/${sized._id}/edit`, { cookie: adminCookie });
  assert.equal(edit.status, 200);
  assert.match(edit.data, /data-options-editor/);
  assert.match(edit.data, /data-colour-photos="\[\]"/);

  const noSize = await change({ action: "add", units: 3 });
  assert.equal(noSize.status, 400);
  assert.equal(noSize.data.code, "option_required");

  const added = await change({ action: "add", units: 3, optionId: s9 });
  assert.equal(added.status, 200, JSON.stringify(added.data));
  assert.match(added.data.message, /Section Sized Spike \(Size 9\): stock up 3, now 3/);
  assert.equal(added.data.product.stock, 5, "the total is the sum of the sizes");
  assert.deepEqual(added.data.product.options.map(o => o.stock), [2, 3]);

  const logged = await AuditLog.findOne({ action: "inventory.stock_changed", target: `product:${sized._id}` }).sort({ at: -1 }).lean();
  assert.equal(logged.after.option, "Size 9");

  const csv = await call("GET", "/api/admin/inventory/export.csv?q=Sized", { cookie: adminCookie });
  assert.ok(csv.data.includes("Size 9"), "one CSV line per size");
  assert.ok(csv.data.includes("SPK-9"));
  await Product.deleteOne({ _id: sized._id });
});

// ======================= Removed: admin Reviews, and Q&A everywhere =======================

test("Q&A is back (E3): on the product page and as the Questions section; there is still no Reviews section", async () => {
  // The store: questions on the product page, next to the reviews.
  assert.equal((await call("GET", `/api/products/${shoe._id}/questions`)).status, 200);
  const page = await call("GET", `/products/${shoe.slug}`, { cookie: ashaCookie });
  assert.equal(page.status, 200);
  assert.match(page.data, /data-qa/);
  assert.match(page.data, /id="reviews"/);

  // The console: a Questions page in the sidebar; no Reviews page.
  assert.equal((await call("GET", `${ADMIN}/questions`, { cookie: adminCookie })).status, 200);
  assert.equal((await call("GET", `${ADMIN}/reviews`, { cookie: adminCookie })).status, 404, "reviews page should be gone");
  const dashboard = await call("GET", `${ADMIN}/dashboard`, { cookie: adminCookie });
  assert.match(dashboard.data, /data-nav-link="questions"/);
  assert.doesNotMatch(dashboard.data, /data-nav-link="reviews"/);
});

// ======================= Coupons =======================

let couponId;

test("coupons: create with full validation, and the code must be unique", async () => {
  assert.equal((await call("POST", "/api/admin/coupons", { body: {}, cookie: ashaCookie })).status, 401);

  const bad = await call("POST", "/api/admin/coupons", {
    body: { code: "ab", type: "percent", value: 95, startsAt: "2026-05-01", endsAt: "2026-04-01", perUserLimit: 500 },
    cookie: adminCookie
  });
  assert.equal(bad.status, 400);
  assert.ok(bad.data.errors.code, "a short code is refused");
  assert.ok(bad.data.errors.value, "more than 90% is refused");
  assert.ok(bad.data.errors.endsAt, "an expiry before the start is refused");
  assert.ok(bad.data.errors.perUserLimit);

  const made = await call("POST", "/api/admin/coupons", {
    body: { code: " run10 ", type: "percent", value: 10, maxDiscount: 500, minOrder: 1000, endsAt: "2030-12-31", usageLimit: 3, perUserLimit: 1, isActive: true },
    cookie: adminCookie
  });
  assert.equal(made.status, 201);
  couponId = made.data.coupon.id;
  // The code is cleaned and stored in capitals, and money is kept in paise.
  assert.equal(made.data.coupon.code, "RUN10");
  assert.equal(made.data.coupon.value, 10);
  assert.equal(made.data.coupon.maxDiscount, 50000);
  assert.equal(made.data.coupon.minOrder, 100000);
  assert.equal(made.data.coupon.status, "active");
  assert.ok(await AuditLog.exists({ action: "coupon.created", target: `coupon:${couponId}` }));

  // The same code twice is refused with a field error, not a server error.
  const duplicate = await call("POST", "/api/admin/coupons", { body: { code: "RUN10", type: "flat", value: 50 }, cookie: adminCookie });
  assert.equal(duplicate.status, 409);
  assert.ok(duplicate.data.errors.code);

  // A flat coupon bigger than its own minimum order would pay people to shop.
  const silly = await call("POST", "/api/admin/coupons", { body: { code: "SILLY", type: "flat", value: 500, minOrder: 100 }, cookie: adminCookie });
  assert.equal(silly.status, 400);
  // A cap only makes sense on a percent coupon.
  const capOnFlat = await call("POST", "/api/admin/coupons", { body: { code: "FLATCAP", type: "flat", value: 50, maxDiscount: 10 }, cookie: adminCookie });
  assert.equal(capOnFlat.status, 400);
  assert.ok(capOnFlat.data.errors.maxDiscount);

  const form = await call("GET", `${ADMIN}/coupons/new`, { cookie: adminCookie });
  assert.equal(form.status, 200);
  assert.match(form.data, /data-coupon-form/);
});

test("coupons: list with status, search, filters and sorting", async () => {
  await Coupon.create({ code: "OLD20", type: "percent", value: 20, endsAt: new Date("2020-01-01"), description: "Last winter" });
  await Coupon.create({ code: "SOON15", type: "percent", value: 15, startsAt: new Date("2099-01-01") });
  await Coupon.create({ code: "OFFNOW", type: "flat", value: 10000, isActive: false });

  const all = await call("GET", "/api/admin/coupons", { cookie: adminCookie });
  assert.equal(all.status, 200);
  assert.equal(all.data.totals.all, 4);
  assert.equal(all.data.totals.active, 1);
  assert.equal(all.data.totals.expired, 1);
  assert.equal(all.data.totals.scheduled, 1);
  assert.equal(all.data.totals.disabled, 1);

  const by = async query => (await call("GET", `/api/admin/coupons?${query}`, { cookie: adminCookie })).data.coupons.map(c => c.code);
  assert.deepEqual(await by("status=active"), ["RUN10"]);
  assert.deepEqual(await by("status=expired"), ["OLD20"]);
  assert.deepEqual(await by("status=scheduled"), ["SOON15"]);
  assert.deepEqual(await by("status=disabled"), ["OFFNOW"]);
  assert.deepEqual(await by("q=run"), ["RUN10"]);
  assert.deepEqual(await by("q=winter"), ["OLD20"]);
  assert.deepEqual(await by("sort=code_asc"), ["OFFNOW", "OLD20", "RUN10", "SOON15"]);
  assert.equal((await by("status=%24ne&sort=%7B%7D")).length, 4); // junk filters are ignored

  const page = await call("GET", `${ADMIN}/coupons?status=active`, { cookie: adminCookie });
  assert.equal(page.status, 200);
  assert.match(page.data, /RUN10/);
  assert.match(page.data, /data-coupon-toggle/);
});

test("coupons: editing keeps the use count, and the enable/disable toggle works", async () => {
  const edited = await call("PATCH", `/api/admin/coupons/${couponId}`, {
    body: { code: "RUN10", type: "percent", value: 15, maxDiscount: 600, minOrder: 1000, endsAt: "2030-12-31", usageLimit: 3, perUserLimit: 1, isActive: true },
    cookie: adminCookie
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.data.coupon.value, 15);
  assert.equal(edited.data.coupon.usedCount, 0);
  assert.ok(await AuditLog.exists({ action: "coupon.updated", target: `coupon:${couponId}` }));
  assert.equal((await call("PATCH", `/api/admin/coupons/${couponId}`, { body: { code: "RUN10", type: "percent", value: 999 }, cookie: adminCookie })).status, 400);

  const off = await call("PATCH", `/api/admin/coupons/${couponId}/active`, { body: { isActive: false }, cookie: adminCookie });
  assert.equal(off.data.coupon.status, "disabled");
  assert.ok(await AuditLog.exists({ action: "coupon.disabled" }));
  assert.equal((await call("PATCH", `/api/admin/coupons/${couponId}/active`, { body: { isActive: "nope" }, cookie: adminCookie })).status, 400);

  const on = await call("PATCH", `/api/admin/coupons/${couponId}/active`, { body: { isActive: true }, cookie: adminCookie });
  assert.equal(on.data.coupon.status, "active");
  assert.ok(await AuditLog.exists({ action: "coupon.enabled" }));

  const edit = await call("GET", `${ADMIN}/coupons/${couponId}/edit`, { cookie: adminCookie });
  assert.equal(edit.status, 200);
  assert.match(edit.data, /value="RUN10"/);
});

test("coupons store side: the server decides, and a disabled coupon stops working at once", async () => {
  // Something in the basket, above the coupon's minimum order.
  await call("DELETE", "/api/cart", { cookie: ashaCookie });
  assert.equal((await call("POST", "/api/cart/items", { body: { productId: String(shoe._id), quantity: 1 } , cookie: ashaCookie })).status, 201);

  // The customer sees the coupons they could use.
  const offered = await call("GET", "/api/coupons", { cookie: ashaCookie });
  assert.equal(offered.status, 200);
  const codes = offered.data.coupons.map(c => c.code);
  assert.ok(codes.includes("RUN10"), "a running coupon is offered at checkout");
  assert.ok(!codes.includes("OLD20"), "an expired coupon is never offered");
  assert.ok(!codes.includes("SOON15"), "a coupon that has not started is never offered");
  assert.ok(!codes.includes("OFFNOW"), "a disabled coupon is never offered");

  // Applying it is judged on the server, against the live cart.
  const applied = await call("POST", "/api/checkout/coupon", { body: { code: "run10" }, cookie: ashaCookie });
  assert.equal(applied.status, 200);
  assert.equal(applied.data.coupon.code, "RUN10");
  // 15% of ₹3,000 is ₹450, under the ₹600 cap.
  assert.equal(applied.data.coupon.saving, Math.round(shoe.price * 0.15));
  // The quote works the discount out again rather than trusting the browser.
  const quote = await call("POST", "/api/checkout/quote", { body: {}, cookie: ashaCookie });
  assert.equal(quote.data.quote.totals.couponDiscount, Math.round(shoe.price * 0.15));

  // Expired, not-yet-started, disabled and unknown codes are all refused by the server.
  for (const code of ["OLD20", "SOON15", "OFFNOW", "NOSUCH"]) {
    const res = await call("POST", "/api/checkout/coupon", { body: { code }, cookie: ashaCookie });
    assert.equal(res.status, 400, `${code} should be refused`);
  }

  // Disabling it while a customer holds it takes effect on the very next check.
  await call("POST", "/api/checkout/coupon", { body: { code: "RUN10" }, cookie: ashaCookie });
  await call("PATCH", `/api/admin/coupons/${couponId}/active`, { body: { isActive: false }, cookie: adminCookie });
  const afterOff = await call("POST", "/api/checkout/quote", { body: {}, cookie: ashaCookie });
  assert.equal(afterOff.data.quote.totals.couponDiscount, 0);
  assert.match(afterOff.data.quote.couponNotice, /not valid|expired/i);
  await call("PATCH", `/api/admin/coupons/${couponId}/active`, { body: { isActive: true }, cookie: adminCookie });

  // Removing it is a server action too.
  assert.equal((await call("DELETE", "/api/checkout/coupon", { cookie: ashaCookie })).status, 200);
  assert.equal((await call("POST", "/api/checkout/quote", { body: {}, cookie: ashaCookie })).data.quote.totals.couponDiscount, 0);
  // Guests have no cart, so they cannot apply anything.
  assert.equal((await call("POST", "/api/checkout/coupon", { body: { code: "RUN10" } })).status, 401);
});

test("coupons: the detail page shows who used it and the total discount given", async () => {
  // Two orders that used the coupon, recorded the way checkout records them.
  const order = await makeOrder(asha, shoe, { couponCode: "RUN10", couponDiscount: 45000 });
  const second = await makeOrder(ravi, shoe, { couponCode: "RUN10", couponDiscount: 45000 });
  await CouponRedemption.create([
    { coupon: couponId, user: asha._id, order: order._id, code: "RUN10", discount: 45000 },
    { coupon: couponId, user: ravi._id, order: second._id, code: "RUN10", discount: 45000 }
  ]);
  await Coupon.updateOne({ _id: couponId }, { $set: { usedCount: 2 } });

  const detail = await call("GET", `/api/admin/coupons/${couponId}`, { cookie: adminCookie });
  assert.equal(detail.status, 200);
  assert.equal(detail.data.totals.uses, 2);
  assert.equal(detail.data.totals.customers, 2);
  assert.equal(detail.data.totals.discountGiven, 90000);
  assert.equal(detail.data.coupon.usesLeft, 1);
  const emails = detail.data.uses.map(u => u.customer && u.customer.email).sort();
  assert.deepEqual(emails, ["asha@sections.test", "ravi@sections.test"]);
  assert.ok(detail.data.uses.every(u => u.orderId.startsWith("NX-2026-")));

  const page = await call("GET", `${ADMIN}/coupons/${couponId}`, { cookie: adminCookie });
  assert.equal(page.status, 200);
  assert.match(page.data, /asha@sections\.test/);
  assert.match(page.data, /RUN10/);
  assert.equal((await call("GET", `${ADMIN}/coupons/${couponId}`)).status, 404);
  assert.equal((await call("GET", "/api/admin/coupons/not-an-id", { cookie: adminCookie })).status, 404);
});

test("coupons: a soft delete keeps the history but the code can never be used again", async () => {
  const deleted = await call("DELETE", `/api/admin/coupons/${couponId}`, { cookie: adminCookie });
  assert.equal(deleted.status, 200);
  assert.ok(await AuditLog.exists({ action: "coupon.deleted", target: `coupon:${couponId}` }));

  // Gone from the admin list, and from the API.
  assert.ok(!(await call("GET", "/api/admin/coupons", { cookie: adminCookie })).data.coupons.some(c => c.code === "RUN10"));
  assert.equal((await call("GET", `/api/admin/coupons/${couponId}`, { cookie: adminCookie })).status, 404);

  // The row and its redemptions are still there, so reports and past orders stay correct.
  const row = await Coupon.findById(couponId).lean();
  assert.equal(row.isDeleted, true);
  assert.equal(row.usedCount, 2);
  assert.equal(await CouponRedemption.countDocuments({ coupon: couponId }), 2);

  // The store behaves as though the code never existed.
  assert.equal((await call("POST", "/api/checkout/coupon", { body: { code: "RUN10" }, cookie: ashaCookie })).status, 400);
  assert.ok(!(await call("GET", "/api/coupons", { cookie: ashaCookie })).data.coupons.some(c => c.code === "RUN10"));
});

// ======================= Customers and System =======================

test("customers: the list, blocking, and the search that feeds Ctrl+K", async () => {
  const list = await call("GET", "/api/admin/customers?q=asha", { cookie: adminCookie });
  assert.equal(list.status, 200);
  assert.equal(list.data.customers.length, 1);
  assert.equal(list.data.customers[0].passwordHash, undefined);

  const page = await call("GET", `${ADMIN}/customers`, { cookie: adminCookie });
  assert.equal(page.status, 200);
  assert.match(page.data, /data-block-user/);

  // The console's search still offers customers, because the page exists again.
  const search = await call("GET", "/api/admin/search?q=asha", { cookie: adminCookie });
  assert.equal(search.data.results.customers[0].email, "asha@sections.test");
  assert.ok(Array.isArray(search.data.results.orders));
  assert.ok(Array.isArray(search.data.results.products));
});

test("system status: health, counts and what is switched on, with no secrets", async () => {
  assert.equal((await call("GET", "/api/admin/system")).status, 401);
  const res = await call("GET", "/api/admin/system", { cookie: adminCookie });
  assert.equal(res.status, 200);
  assert.equal(res.data.healthy, true);
  assert.equal(res.data.database.ok, true);
  assert.equal(typeof res.data.database.pingMs, "number");
  assert.ok(res.data.app.version);
  assert.ok(res.data.app.node.startsWith("v"));

  const counts = Object.fromEntries(res.data.counts.map(c => [c.label, c.value]));
  assert.ok(counts.Orders > 0);
  assert.ok(counts.Products >= 2);
  assert.equal(typeof counts["Signed-in devices"], "number");

  const features = Object.fromEntries(res.data.features.map(f => [f.key, f.on]));
  assert.equal(typeof features.razorpay, "boolean");
  assert.equal(typeof features.mail, "boolean");
  // The session rules are shown, but never a key or a secret.
  assert.equal(res.data.session[0].value, "15m");
  const text = JSON.stringify(res.data);
  assert.doesNotMatch(text, /rzp_test_dummykey|test-key-secret|test-webhook-secret|hs256-signing/);

  const page = await call("GET", `${ADMIN}/system`, { cookie: adminCookie });
  assert.equal(page.status, 200);
  assert.match(page.data, /System status/);
  assert.match(page.data, /data-system-refresh/);
  assert.doesNotMatch(page.data, /rzp_test_dummykey|test-key-secret/);
});
