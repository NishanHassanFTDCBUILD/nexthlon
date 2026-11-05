// The admin console at a private ADMIN_PATH: hidden from customers and guests, with its own session.
process.env.TEST_ADMIN_PATH = "/nx-console-test1";
require("./helpers");
const test = require("node:test");
const assert = require("node:assert/strict");

if (!process.env.TEST_MONGODB_URI) {
  test("admin path tests (set TEST_MONGODB_URI to run them)", { skip: true }, () => {});
  return;
}

const mongoose = require("mongoose");
const app = require("../app");
const User = require("../models/User");
const { hashPassword } = require("../services/authService");

const ADMIN = "/nx-console-test1";
const dbUrl = new URL(process.env.TEST_MONGODB_URI);
dbUrl.pathname = `${dbUrl.pathname.replace(/\/$/, "")}_adminpath`;

let server;
let base;

async function call(method, path, { body, cookie } = {}) {
  const headers = { Accept: "text/html,application/json", Origin: base };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(base + path, { method, headers, redirect: "manual", body: body === undefined ? undefined : JSON.stringify(body) });
  const setCookie = response.headers.get("set-cookie") || "";
  const match = setCookie.match(/(nx_token|nx_admin)=([^;]*)/);
  const type = response.headers.get("content-type") || "";
  const data = type.includes("json") ? await response.json() : await response.text();
  return { status: response.status, data, headers: response.headers, location: response.headers.get("location"), setCookie, cookie: match && match[2] ? `${match[1]}=${match[2]}` : null };
}

test.before(async () => {
  if (!/test/i.test(dbUrl.pathname)) throw new Error("The test database must have 'test' in its name.");
  await mongoose.connect(dbUrl.href);
  await mongoose.connection.dropDatabase();
  // Build every model's indexes now (unique, text). Background index builds could race with the
  // drop above and make index-dependent tests flaky.
  await Promise.all(Object.values(mongoose.models).map(model => model.syncIndexes()));
  await User.create({ name: "Console Admin", email: "admin@path.test", passwordHash: await hashPassword("AdminPass123"), role: "admin" });
  server = app.listen(0);
  await new Promise(resolve => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  await new Promise(resolve => server.close(resolve));
});

test("customer pages never link to the admin console", async () => {
  const customer = await call("POST", "/api/signup", { body: { name: "Lina Paul", email: "lina@path.test", password: "pathway2024", confirmPassword: "pathway2024" } });
  for (const [path, cookie] of [["/login", null], ["/signup", null], ["/", null], ["/products", null], ["/", customer.cookie], ["/account", customer.cookie]]) {
    const page = await call("GET", path, { cookie });
    assert.equal(page.status, 200, path);
    assert.doesNotMatch(page.data, /\/admin|nx-console|Admin console|Admin sign in|Store administrator/i, path);
  }
  const robots = await call("GET", "/robots.txt");
  assert.doesNotMatch(robots.data, /admin|nx-console/i);
});

test("the old /admin URLs are a plain 404 when ADMIN_PATH is set", async () => {
  for (const path of ["/admin", "/admin/login", "/admin/dashboard", "/admin/products"]) {
    const res = await call("GET", path);
    assert.equal(res.status, 404, path);
    assert.equal(res.location, null, path);
    assert.doesNotMatch(res.data, /nx-console/, path);
  }
});

test("guests and customers get a 404 on admin pages; only the login URL shows a form", async () => {
  const login = await call("GET", `${ADMIN}/login`);
  assert.equal(login.status, 200);
  assert.match(login.data, /data-endpoint="\/api\/admin\/login"/);
  assert.match(login.data, /<meta name="robots" content="noindex, nofollow">/);
  assert.equal(login.headers.get("x-robots-tag"), "noindex, nofollow");

  // A 404 inside the admin path looks exactly like any other 404 (nothing hints at the console).
  const hidden = await call("GET", `${ADMIN}/dashboard`);
  const elsewhere = await call("GET", "/no-such-page-here");
  assert.equal(hidden.status, 404);
  assert.equal(hidden.headers.get("x-robots-tag"), elsewhere.headers.get("x-robots-tag"));
  assert.doesNotMatch(hidden.data, /noindex|data-admin-path|nx-console/);
  assert.equal(hidden.data.replace(/\/nx-console-test1\/dashboard/g, ""), elsewhere.data.replace(/\/no-such-page-here/g, ""));

  const customer = await call("POST", "/api/login", { body: { email: "lina@path.test", password: "pathway2024" } });
  assert.match(customer.cookie, /^nx_token=/);
  for (const path of [ADMIN, `${ADMIN}/dashboard`, `${ADMIN}/users`, `${ADMIN}/products`, `${ADMIN}/tickets`]) {
    for (const cookie of [null, customer.cookie, customer.cookie.replace("nx_token", "nx_admin")]) {
      const res = await call("GET", path, { cookie });
      assert.equal(res.status, 404, `${path} ${cookie ? "customer" : "guest"}`);
      assert.equal(res.location, null);
    }
  }
});

test("an admin signs in at the new path with a separate 8-hour cookie, and signs out", async () => {
  // The customer sign-in refuses admins, and the admin sign-in refuses customers.
  assert.equal((await call("POST", "/api/login", { body: { email: "admin@path.test", password: "AdminPass123" } })).status, 403);
  assert.equal((await call("POST", "/api/admin/login", { body: { email: "lina@path.test", password: "pathway2024" } })).status, 403);

  const admin = await call("POST", "/api/admin/login", { body: { email: "admin@path.test", password: "AdminPass123" } });
  assert.equal(admin.status, 200);
  assert.match(admin.cookie, /^nx_admin=/);
  assert.match(admin.setCookie, /Max-Age=28800/);
  assert.match(admin.setCookie, /HttpOnly/);
  assert.match(admin.setCookie, /SameSite=Strict/);

  assert.equal((await call("GET", `${ADMIN}/login`, { cookie: admin.cookie })).location, `${ADMIN}/dashboard`);
  assert.equal((await call("GET", ADMIN, { cookie: admin.cookie })).location, `${ADMIN}/dashboard`);
  const dashboard = await call("GET", `${ADMIN}/dashboard`, { cookie: admin.cookie });
  assert.equal(dashboard.status, 200);
  assert.match(dashboard.data, new RegExp(`data-admin-path="${ADMIN}"`));
  assert.match(dashboard.data, new RegExp(`href="${ADMIN}/products"`));
  assert.match(dashboard.data, /<meta name="robots" content="noindex, nofollow">/);
  assert.equal((await call("GET", `${ADMIN}/products`, { cookie: admin.cookie })).status, 200);
  assert.equal((await call("GET", "/api/admin/dashboard", { cookie: admin.cookie })).status, 200);

  // The admin cookie is never read by the store: there the admin is just a guest.
  assert.equal((await call("GET", "/account", { cookie: admin.cookie })).status, 302);
  assert.equal((await call("GET", "/api/me", { cookie: admin.cookie })).status, 401);

  const out = await call("POST", "/api/admin/logout", { cookie: admin.cookie });
  assert.equal(out.status, 200);
  assert.match(out.setCookie, /nx_admin=;/);
});

test("after signing in, the admin login only sends the admin to pages inside the console", async () => {
  assert.match((await call("GET", `${ADMIN}/login?next=%2Faccount`)).data, new RegExp(`name="next" value="${ADMIN}/dashboard"`));
  assert.match((await call("GET", `${ADMIN}/login?next=${encodeURIComponent(`${ADMIN}/products`)}`)).data, new RegExp(`name="next" value="${ADMIN}/products"`));
});

// ---------- Part 2: layout, navigation, search and notifications ----------
const Product = require("../models/Product");
const Order = require("../models/Order");

async function adminSession() {
  return (await call("POST", "/api/admin/login", { body: { email: "admin@path.test", password: "AdminPass123" } })).cookie;
}

test("admin layout: grouped sidebar, top bar, and X-Partial returns only the section", async () => {
  const cookie = await adminSession();
  const full = await call("GET", `${ADMIN}/products`, { cookie });
  for (const group of ["Overview", "Sales", "Catalog", "Customers", "Marketing", "Content", "Reports", "Settings"]) assert.match(full.data, new RegExp(`data-admin-group="${group}"`));
  assert.match(full.data, /data-admin-search-input/);
  assert.match(full.data, /data-admin-palette/);
  assert.match(full.data, /data-admin-bell/);
  assert.match(full.data, /data-theme-toggle/);
  assert.match(full.data, /data-nav-main="admin"/);
  assert.match(full.data, /class="admin-link is-active" data-nav-link="products"/);
  assert.match(full.data, /\/js\/section-nav\.js/);
  assert.doesNotMatch(full.data, /\/js\/motion\.js|motion\.css/);

  const partial = await fetch(base + `${ADMIN}/customers`, { headers: { Cookie: cookie, "X-Partial": "1" } });
  const html = await partial.text();
  assert.equal(partial.status, 200);
  assert.match(partial.headers.get("vary") || "", /X-Partial/);
  assert.match(html, /data-page="admin-customers"/);
  assert.match(html, /data-page-title="Customers \| Nexthlon Admin"/);
  assert.doesNotMatch(html, /<html|admin-side|data-admin-search|<script/);

  // The old customer list address moves to /customers, keeping the search.
  assert.equal((await call("GET", `${ADMIN}/users?q=lina`, { cookie })).location, `${ADMIN}/customers?q=lina`);
});

test("store settings hold the referral reward (moved from the dashboard); unbuilt sections show a notice", async () => {
  const cookie = await adminSession();
  const settings = await call("GET", `${ADMIN}/settings`, { cookie });
  assert.equal(settings.status, 200);
  assert.match(settings.data, /data-referral-form/);
  assert.doesNotMatch((await call("GET", `${ADMIN}/dashboard`, { cookie })).data, /data-referral-form/);

  const soon = await call("GET", `${ADMIN}/analytics`, { cookie });
  assert.equal(soon.status, 200);
  assert.match(soon.data, /Coming in Part 5/);
  assert.equal((await call("GET", `${ADMIN}/not-a-section`, { cookie })).status, 404);
  // Still invisible to everyone else.
  assert.equal((await call("GET", `${ADMIN}/settings`)).status, 404);
  assert.equal((await call("GET", `${ADMIN}/analytics`)).status, 404);
});

test("global search finds orders, products and customers; it is admin-only and validated", async () => {
  const cookie = await adminSession();
  const lina = await User.findOne({ email: "lina@path.test" });
  await Product.collection.insertOne({ name: "Path Finder Boots", slug: "path-finder-boots", brand: "Nexthlon", basePrice: 199900, price: 199900, mrp: 249900, stock: 2, isListed: true, categoryListed: true, image: "/img/favicon.svg", images: [] });
  await Order.collection.insertOne({ orderId: "NX-2026-777001", user: lina._id, items: [], total: 199900, orderStatus: "placed", paymentStatus: "pending", paymentMethod: "cod", address: { fullName: "Lina Paul", phone: "9876543210" }, createdAt: new Date(), statusHistory: [] });

  assert.equal((await call("GET", "/api/admin/search?q=lina")).status, 401);
  assert.equal((await call("GET", "/api/admin/search?q=l", { cookie })).status, 400);
  const byName = await call("GET", "/api/admin/search?q=lina", { cookie });
  assert.equal(byName.status, 200);
  assert.equal(byName.data.results.customers[0].email, "lina@path.test");
  assert.equal(byName.data.results.orders[0].orderId, "NX-2026-777001");
  assert.equal(byName.data.results.customers[0].passwordHash, undefined);
  assert.equal((await call("GET", "/api/admin/search?q=777001", { cookie })).data.results.orders.length, 1);
  assert.equal((await call("GET", "/api/admin/search?q=path%20finder", { cookie })).data.results.products[0].name, "Path Finder Boots");
  // Regex characters are plain text, never a pattern.
  assert.equal((await call("GET", "/api/admin/search?q=.*", { cookie })).data.results.customers.length, 0);
});

test("notifications count what needs attention, for admins only", async () => {
  const cookie = await adminSession();
  assert.equal((await call("GET", "/api/admin/notifications")).status, 401);
  const res = await call("GET", "/api/admin/notifications", { cookie });
  assert.equal(res.status, 200);
  const byKey = Object.fromEntries(res.data.items.map(item => [item.key, item.count]));
  assert.equal(byKey["to-confirm"], 1);
  assert.equal(byKey["low-stock"], 1);
  assert.equal(byKey["new-orders"], 1);
  assert.equal(res.data.total, byKey["to-confirm"] + byKey.returns + byKey["low-stock"] + byKey["out-of-stock"] + byKey.tickets);
});

// ---------- Part 3: the dashboard ----------
const AuditLog = require("../models/AuditLog");
const WalletTransaction = require("../models/WalletTransaction");

test("dashboard KPIs, previous-period change and charts come from real orders", async () => {
  const cookie = await adminSession();
  const lina = await User.findOne({ email: "lina@path.test" });
  const product = await Product.findOne({ slug: "path-finder-boots" });
  const now = Date.now();
  const base = { user: lina._id, items: [{ product: product._id, name: product.name, slug: product.slug, price: 100000, mrp: 120000, quantity: 2, lineTotal: 200000, status: "delivered" }], address: { fullName: "Lina Paul", phone: "9876543210", line1: "1 Road", city: "Kochi", state: "Kerala", pincode: "682001" }, mrpTotal: 240000, subtotal: 200000, statusHistory: [] };
  // This period: two paid orders (one with a refund and a coupon) and one cancelled.
  await Order.create([
    { ...base, orderId: "NX-2026-888001", total: 150000, walletUsed: 50000, couponDiscount: 10000, paymentMethod: "razorpay", paymentStatus: "partially_refunded", orderStatus: "delivered", refundedAmount: 20000, refunds: [{ amount: 20000, method: "wallet", status: "processed", at: new Date(now - 3600000) }] },
    { ...base, orderId: "NX-2026-888002", total: 200000, paymentMethod: "cod", paymentStatus: "paid", orderStatus: "delivered" },
    { ...base, orderId: "NX-2026-888003", total: 90000, couponDiscount: 5000, paymentMethod: "razorpay", paymentStatus: "failed", orderStatus: "cancelled" }
  ]);
  // The previous period: one paid order 40 days ago (outside "30 days", inside the period before it).
  const old = await Order.create({ ...base, orderId: "NX-2026-888004", total: 100000, paymentMethod: "cod", paymentStatus: "paid", orderStatus: "delivered" });
  await Order.collection.updateOne({ _id: old._id }, { $set: { createdAt: new Date(now - 40 * 86400000) } });
  await WalletTransaction.create({ user: lina._id, type: "credit", amount: 10000, kind: "referral", reason: "Referral", balanceAfter: 10000 });

  const res = await call("GET", "/api/admin/dashboard?range=30d", { cookie });
  assert.equal(res.status, 200);
  const kpi = Object.fromEntries(res.data.kpis.map(k => [k.key, k]));
  // Paid revenue = (1500 + 500 wallet - 200 refunded) + 2000 = ₹3,800. The unpaid test order from earlier doesn't count.
  assert.equal(kpi.revenue.value, 380000);
  assert.equal(kpi.revenue.previous, 100000);
  assert.equal(kpi.revenue.change, 280);
  assert.equal(kpi.orders.value, 4); // 3 above + the pending one from the search test
  assert.equal(kpi.aov.value, 190000);
  assert.equal(kpi.refunds.value, 20000);
  assert.equal(kpi.coupons.value, 10000); // the cancelled order's coupon is not counted
  assert.equal(kpi.credits.value, 10000);
  assert.equal(kpi.revenue.spark.length, 30);
  assert.equal(res.data.kpis.length, 8);

  const charts = res.data.charts;
  assert.equal(charts.timeline.length, 30);
  assert.equal(charts.timeline.reduce((sum, b) => sum + b.revenue, 0), 380000);
  assert.equal(charts.statuses.find(s => s.key === "delivered").count, 2);
  assert.equal(charts.payments.find(p => p.key === "razorpay").count, 2);
  assert.equal(charts.topByRevenue[0].name, "Path Finder Boots");
  assert.equal(charts.topByRevenue[0].units, 4); // cancelled order excluded
  assert.equal(charts.cities[0].city, "Kochi");
  assert.equal(charts.heatmap.length, 7);
  assert.equal(charts.heatmap.flat().reduce((a, b) => a + b, 0), 4);
  // Lina ordered 40 days ago, so every order this period is from a returning customer.
  assert.equal(charts.newReturning.reduce((sum, b) => sum + b.returning, 0), 4);
  assert.ok(res.data.panels.actions.find(a => a.key === "failed"));

  // The page renders every chart holder and the KPIs, with data for the charts.
  const page = await call("GET", `${ADMIN}/dashboard?range=30d`, { cookie });
  assert.equal(page.status, 200);
  for (const chart of ["timeline", "statuses", "payments", "newReturning", "categories", "heatmap"]) assert.match(page.data, new RegExp(`data-chart="${chart}"`));
  assert.match(page.data, /data-dashboard="\{/);
  assert.match(page.data, /Show as a table/);
  assert.match(page.data, /₹3,800/);
  // A bad custom range falls back with a message instead of failing.
  assert.match((await call("GET", `${ADMIN}/dashboard?range=custom&from=2026-10-10&to=2026-10-01`, { cookie })).data, /start date must be on or before/);
});

test("quick restock adds stock atomically, is validated and audit-logged", async () => {
  const cookie = await adminSession();
  const product = await Product.findOne({ slug: "path-finder-boots" });
  const url = `/api/admin/products/${product._id}/stock`;
  assert.equal((await call("PATCH", url, { body: { add: 5 } })).status, 401);
  assert.equal((await call("PATCH", url, { body: { add: 0 }, cookie })).status, 400);
  assert.equal((await call("PATCH", url, { body: { add: "5; drop" }, cookie })).status, 400);
  assert.equal((await call("PATCH", "/api/admin/products/not-an-id/stock", { body: { add: 5 }, cookie })).status, 404);
  const before = product.stock;
  const ok = await call("PATCH", url, { body: { add: 5 }, cookie });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.product.stock, before + 5);
  assert.equal((await Product.findById(product._id)).stock, before + 5);
  const log = await AuditLog.findOne({ action: "product.restock" }).lean();
  assert.equal(log.target, `product:${product._id}`);
  assert.equal(log.before.stock, before);
  assert.equal(log.after.stock, before + 5);
});

test("sales export: CSV of the range's orders, admin only, formulas neutralised", async () => {
  const cookie = await adminSession();
  assert.equal((await call("GET", "/api/admin/reports/sales.csv?range=30d")).status, 401);
  await Order.collection.updateOne({ orderId: "NX-2026-888002" }, { $set: { "address.fullName": "=HYPERLINK(\"http://evil\")" } });
  const res = await fetch(`${base}/api/admin/reports/sales.csv?range=30d`, { headers: { Cookie: cookie } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /text\/csv/);
  assert.match(res.headers.get("content-disposition"), /attachment; filename="nexthlon-sales-.*\.csv"/);
  const text = await res.text();
  const lines = text.trim().split("\r\n");
  assert.match(lines[0], /Order.*Placed \(IST\).*Total charged/);
  assert.equal(lines.length, 5); // header + 4 orders in the last 30 days
  assert.match(text, /"NX-2026-888001"/);
  assert.match(text, /"'=HYPERLINK/);
  assert.doesNotMatch(text, /"NX-2026-888004"/); // 40 days ago
});
