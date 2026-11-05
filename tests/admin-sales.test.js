// Admin Part 4: orders, returns, the money ledger, refunds and abandoned carts.
require("./helpers");
const test = require("node:test");
const assert = require("node:assert/strict");

if (!process.env.TEST_MONGODB_URI) {
  test("admin sales tests (set TEST_MONGODB_URI to run them)", { skip: true }, () => {});
  return;
}

const mongoose = require("mongoose");
const app = require("../app");
const User = require("../models/User");
const Product = require("../models/Product");
const Order = require("../models/Order");
const Cart = require("../models/Cart");
const AuditLog = require("../models/AuditLog");
const WalletTransaction = require("../models/WalletTransaction");
const mailService = require("../services/mailService");
const categoryService = require("../services/categoryService");
const { hashPassword } = require("../services/authService");

const dbUrl = new URL(process.env.TEST_MONGODB_URI);
dbUrl.pathname = `${dbUrl.pathname.replace(/\/$/, "")}_sales`;
const ADMIN = "/admin";
let server;
let base;
let adminCookie;
let customerCookie;
let customer;
let shoe;
let socks;
const outbox = [];

async function call(method, path, { body, cookie } = {}) {
  const headers = { Accept: "application/json", Origin: base };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(base + path, { method, headers, redirect: "manual", body: body === undefined ? undefined : JSON.stringify(body) });
  const setCookie = response.headers.get("set-cookie") || "";
  const match = setCookie.match(/(nx_token|nx_admin)=([^;]*)/);
  const type = response.headers.get("content-type") || "";
  const data = type.includes("json") ? await response.json() : type.includes("text") ? await response.text() : Buffer.from(await response.arrayBuffer());
  return { status: response.status, data, headers: response.headers, cookie: match && match[2] ? `${match[1]}=${match[2]}` : null };
}

let seq = 0;
async function makeOrder(fields = {}) {
  seq += 1;
  const quantity = fields.quantity || 1;
  const product = fields.product || shoe;
  const lineTotal = product.price * quantity;
  return Order.create({
    orderId: `NX-2026-${String(400000 + seq)}`,
    user: customer._id,
    items: [{ product: product._id, name: product.name, slug: product.slug, price: product.price, mrp: product.mrp, quantity, lineTotal, status: fields.itemStatus || fields.orderStatus || "placed" }],
    address: { fullName: "Asha Nair", phone: "9876543210", line1: "1 Beach Road", city: fields.city || "Kochi", state: "Kerala", pincode: "682001" },
    mrpTotal: product.mrp * quantity,
    subtotal: lineTotal,
    total: fields.total ?? lineTotal,
    walletUsed: fields.walletUsed || 0,
    couponCode: fields.couponDiscount ? "SAVE10" : "",
    couponDiscount: fields.couponDiscount || 0,
    paymentMethod: fields.paymentMethod || "cod",
    paymentStatus: fields.paymentStatus || "pending",
    orderStatus: fields.orderStatus || "placed",
    deliveredAt: fields.deliveredAt || null,
    stockReserved: true,
    razorpay: { orderId: fields.razorpayOrderId || "", paymentId: fields.paymentId || "" },
    returnReason: fields.returnReason || "",
    statusHistory: []
  });
}

test.before(async () => {
  if (!/test/i.test(dbUrl.pathname)) throw new Error("The test database must have 'test' in its name.");
  await mongoose.connect(dbUrl.href);
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map(model => model.syncIndexes()));
  await User.create({ name: "Sales Admin", email: "admin@sales.test", passwordHash: await hashPassword("AdminPass123"), role: "admin" });
  const running = await categoryService.ensureCategory("Running");
  categoryService.invalidate();
  shoe = await Product.create({ name: "Sales Trail Shoe", slug: "sales-trail-shoe", category: running._id, brand: "Nexthlon", basePrice: 300000, mrp: 400000, stock: 10, image: "/img/favicon.svg" });
  socks = await Product.create({ name: "Sales Socks", slug: "sales-socks", category: running._id, brand: "Nexthlon", basePrice: 50000, mrp: 60000, stock: 20, image: "/img/favicon.svg" });
  server = app.listen(0);
  await new Promise(resolve => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  customerCookie = (await call("POST", "/api/signup", { body: { name: "Asha Nair", email: "asha@sales.test", password: "sales2024", confirmPassword: "sales2024" } })).cookie;
  customer = await User.findOne({ email: "asha@sales.test" });
  adminCookie = (await call("POST", "/api/admin/login", { body: { email: "admin@sales.test", password: "AdminPass123" } })).cookie;
  mailService.useTestOutbox(outbox);
});

test.after(async () => {
  mailService.useTestOutbox(null);
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  await new Promise(resolve => server.close(resolve));
});

test("orders list: filters, search by customer email, sort and admin-only access", async () => {
  const a = await makeOrder({ city: "Kochi" });
  const b = await makeOrder({ city: "Pune", paymentMethod: "razorpay", paymentStatus: "paid", paymentId: "pay_TEST1", orderStatus: "confirmed", quantity: 2 });
  assert.equal((await call("GET", "/api/admin/orders")).status, 401);
  assert.equal((await call("GET", "/api/admin/orders", { cookie: customerCookie })).status, 401);
  const all = await call("GET", "/api/admin/orders", { cookie: adminCookie });
  assert.equal(all.status, 200);
  assert.equal(all.data.pagination.total, 2);
  const by = async query => (await call("GET", `/api/admin/orders?${query}`, { cookie: adminCookie })).data.orders.map(o => o.orderId);
  assert.deepEqual(await by("status=confirmed"), [b.orderId]);
  assert.deepEqual(await by("method=cod"), [a.orderId]);
  assert.deepEqual(await by("payment=paid"), [b.orderId]);
  assert.deepEqual(await by("city=pun"), [b.orderId]);
  assert.deepEqual(await by("min=4000"), [b.orderId]);
  assert.deepEqual(await by(`q=${a.orderId}`), [a.orderId]);
  assert.equal((await by("q=asha%40sales.test")).length, 2);
  assert.deepEqual(await by("sort=amount_desc"), [b.orderId, a.orderId]);
  assert.equal((await by("status=%24ne&method=%7B%7D")).length, 2); // junk filters are ignored
  const page = await call("GET", `${ADMIN}/orders?status=confirmed`, { cookie: adminCookie });
  assert.equal(page.status, 200);
  assert.match(page.data, new RegExp(b.orderId));
  assert.match(page.data, /data-bulk-bar/);
  assert.equal((await call("GET", `${ADMIN}/orders`, { cookie: customerCookie })).status, 404);
});

test("status moves forward only, one or in bulk, and every change is audit-logged", async () => {
  const order = await makeOrder();
  const url = `/api/admin/orders/${order.orderId}/status`;
  assert.equal((await call("PATCH", url, { body: { status: "placed" }, cookie: adminCookie })).status, 400);
  assert.equal((await call("PATCH", url, { body: { status: "confirmed" }, cookie: adminCookie })).status, 200);
  assert.equal((await call("PATCH", url, { body: { status: "confirmed" }, cookie: adminCookie })).status, 400); // not forward any more
  assert.equal((await Order.findById(order._id)).orderStatus, "confirmed");
  assert.ok(await AuditLog.findOne({ action: "order.status", target: `order:${order.orderId}` }));

  const other = await makeOrder();
  const cancelled = await makeOrder({ orderStatus: "cancelled", itemStatus: "cancelled" });
  const bulk = await call("POST", "/api/admin/orders/bulk-status", { body: { orderIds: [order.orderId, other.orderId, cancelled.orderId], status: "shipped" }, cookie: adminCookie });
  assert.equal(bulk.status, 200);
  assert.deepEqual(bulk.data.done.sort(), [order.orderId, other.orderId].sort());
  assert.equal(bulk.data.skipped[0].orderId, cancelled.orderId);
  assert.equal((await call("POST", "/api/admin/orders/bulk-status", { body: { orderIds: [], status: "shipped" }, cookie: adminCookie })).status, 400);
  assert.equal((await call("POST", "/api/admin/orders/bulk-status", { body: { orderIds: ["DROP TABLE"], status: "shipped" }, cookie: adminCookie })).status, 400);
  assert.ok(await AuditLog.findOne({ action: "order.bulk_status" }));
});

test("cancel items: stock goes back, paid money is refunded, shipped items can't be cancelled", async () => {
  const before = (await Product.findById(socks._id)).stock;
  const order = await makeOrder({ product: socks, quantity: 2, paymentMethod: "wallet", total: 0, walletUsed: socks.price * 2, paymentStatus: "paid" });
  const res = await call("POST", `/api/admin/orders/${order.orderId}/cancel`, { body: { reason: "Out of stock" }, cookie: adminCookie });
  assert.equal(res.status, 200);
  const after = await Order.findById(order._id);
  assert.equal(after.orderStatus, "cancelled");
  assert.equal(after.refundedAmount, socks.price * 2);
  assert.equal((await Product.findById(socks._id)).stock, before + 2);
  assert.ok(await WalletTransaction.findOne({ user: customer._id, kind: "refund", amount: socks.price * 2 }));

  const shipped = await makeOrder({ orderStatus: "shipped" });
  assert.equal((await call("POST", `/api/admin/orders/${shipped.orderId}/cancel`, { body: {}, cookie: adminCookie })).status, 404);
  const item = shipped.items[0]._id;
  assert.equal((await call("POST", `/api/admin/orders/${shipped.orderId}/cancel`, { body: { itemIds: [String(item)] }, cookie: adminCookie })).status, 400);
});

test("shipments, internal notes and the two PDFs", async () => {
  const order = await makeOrder({ orderStatus: "confirmed" });
  const ship = `/api/admin/orders/${order.orderId}/shipments`;
  assert.equal((await call("POST", ship, { body: { courier: "D", trackingNumber: "x" }, cookie: adminCookie })).status, 400);
  const added = await call("POST", ship, { body: { courier: "Delhivery", trackingNumber: "dl 1234 5678", markShipped: true }, cookie: adminCookie });
  assert.equal(added.status, 201);
  assert.equal(added.data.shipment.trackingNumber, "DL12345678");
  assert.equal(added.data.status, "shipped");

  assert.equal((await call("POST", `/api/admin/orders/${order.orderId}/notes`, { body: { body: "" }, cookie: adminCookie })).status, 400);
  assert.equal((await call("POST", `/api/admin/orders/${order.orderId}/notes`, { body: { body: "Customer asked for a call before delivery." }, cookie: adminCookie })).status, 201);
  const page = await call("GET", `${ADMIN}/orders/${order.orderId}`, { cookie: adminCookie });
  assert.equal(page.status, 200);
  assert.match(page.data, /Customer asked for a call before delivery/);
  assert.match(page.data, /DL12345678/);
  // Notes are internal: the customer's order page never shows them.
  assert.doesNotMatch((await call("GET", `/orders/${order.orderId}`, { cookie: customerCookie })).data, /call before delivery/);

  for (const pdf of ["invoice.pdf", "packing-slip.pdf"]) {
    const res = await call("GET", `/api/admin/orders/${order.orderId}/${pdf}`, { cookie: adminCookie });
    assert.equal(res.status, 200, pdf);
    assert.equal(res.headers.get("content-type"), "application/pdf");
    assert.equal(res.data.subarray(0, 4).toString(), "%PDF");
  }
  assert.equal((await call("GET", `/api/admin/orders/${order.orderId}/invoice.pdf`, { cookie: customerCookie })).status, 401);
});

test("manual refunds never exceed what was paid, and are audit-logged", async () => {
  const order = await makeOrder({ orderStatus: "delivered", paymentStatus: "paid", deliveredAt: new Date() });
  const url = `/api/admin/orders/${order.orderId}/refunds`;
  assert.equal((await call("POST", url, { body: { amount: "100", method: "wallet", reason: "x" }, cookie: adminCookie })).status, 400); // no reason
  assert.equal((await call("POST", url, { body: { amount: "999999", method: "wallet", reason: "Too much" }, cookie: adminCookie })).status, 400);
  const ok = await call("POST", url, { body: { amount: "500", method: "wallet", reason: "Late delivery goodwill" }, cookie: adminCookie });
  assert.equal(ok.status, 201);
  const after = await Order.findById(order._id);
  assert.equal(after.refundedAmount, 50000);
  assert.equal(after.paymentStatus, "partially_refunded");
  const log = await AuditLog.findOne({ action: "order.refund" }).lean();
  assert.equal(log.after.amount, 50000);
});

test("returns: approve restocks and refunds; reject needs a note and keeps the items delivered", async () => {
  const stock = (await Product.findById(shoe._id)).stock;
  const approve = await makeOrder({ orderStatus: "return_requested", itemStatus: "return_requested", paymentStatus: "paid", deliveredAt: new Date(), returnReason: "Wrong size or fit" });
  const list = await call("GET", "/api/admin/returns", { cookie: adminCookie });
  assert.equal(list.status, 200);
  assert.ok(list.data.returns.some(r => r.orderId === approve.orderId));
  const res = await call("POST", `/api/admin/returns/${approve.orderId}/decision`, { body: { decision: "approve", refundMethod: "wallet" }, cookie: adminCookie });
  assert.equal(res.status, 200);
  assert.equal(res.data.refund, shoe.price);
  const done = await Order.findById(approve._id);
  assert.equal(done.orderStatus, "returned");
  assert.equal(done.returnDecision.status, "approved");
  assert.equal(done.refundedAmount, shoe.price);
  assert.equal((await Product.findById(shoe._id)).stock, stock + 1);
  assert.equal((await call("POST", `/api/admin/returns/${approve.orderId}/decision`, { body: { decision: "approve" }, cookie: adminCookie })).status, 400); // already decided

  const reject = await makeOrder({ orderStatus: "return_requested", itemStatus: "return_requested", paymentStatus: "paid", deliveredAt: new Date() });
  assert.equal((await call("POST", `/api/admin/returns/${reject.orderId}/decision`, { body: { decision: "reject" }, cookie: adminCookie })).status, 400);
  assert.equal((await call("POST", `/api/admin/returns/${reject.orderId}/decision`, { body: { decision: "reject", note: "Used and washed, so it can't be resold." }, cookie: adminCookie })).status, 200);
  const kept = await Order.findById(reject._id);
  assert.equal(kept.orderStatus, "delivered");
  assert.equal(kept.returnDecision.status, "rejected");
  assert.equal(kept.refundedAmount, 0);
  assert.ok(await AuditLog.findOne({ action: "return.rejected" }));
  assert.equal((await call("GET", `${ADMIN}/returns?status=approved`, { cookie: adminCookie })).status, 200);
});

test("exports: CSV with formulas neutralised, and a real Excel file", async () => {
  await makeOrder({ city: "=cmd|' /C calc'!A0" });
  const csv = await call("GET", "/api/admin/orders/export.csv?city=%3Dcmd", { cookie: adminCookie });
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get("content-disposition"), /nexthlon-orders-.*\.csv/);
  assert.match(csv.data, /"'=cmd/);
  const lines = csv.data.trim().split("\r\n");
  assert.equal(lines.length, 2);
  const xlsx = await call("GET", "/api/admin/orders/export.xlsx", { cookie: adminCookie });
  assert.equal(xlsx.status, 200);
  assert.match(xlsx.headers.get("content-type"), /spreadsheetml/);
  assert.equal(xlsx.data.subarray(0, 2).toString(), "PK"); // an .xlsx is a zip file
  assert.equal((await call("GET", "/api/admin/orders/export.xlsx", { cookie: customerCookie })).status, 401);
  assert.equal((await call("GET", "/api/admin/transactions/export.csv", { cookie: adminCookie })).status, 200);
});

test("money ledger: every movement, totals, one entry, filters and reconciliation", async () => {
  await makeOrder({ paymentMethod: "razorpay", paymentStatus: "paid", paymentId: "pay_LEDGER1", couponDiscount: 10000 });
  const unmatched = await makeOrder({ paymentMethod: "razorpay", paymentStatus: "paid", paymentId: "" }); // paid but no payment recorded
  await makeOrder({ paymentMethod: "cod", orderStatus: "delivered", itemStatus: "delivered", paymentStatus: "pending", deliveredAt: new Date() }); // not collected
  await WalletTransaction.create({ user: customer._id, type: "credit", amount: 10000, kind: "referral", reason: "Referral reward", balanceAfter: 10000 });

  const res = await call("GET", "/api/admin/transactions", { cookie: adminCookie });
  assert.equal(res.status, 200);
  const types = new Set(res.data.transactions.map(t => t.type));
  for (const type of ["payment", "refund", "coupon", "wallet_credit", "wallet_payment"]) assert.ok(types.has(type), type);
  assert.ok(res.data.totals.in > 0);
  assert.ok(res.data.totals.out > 0);
  assert.equal(res.data.totals.net, res.data.totals.in - res.data.totals.out);
  const payments = await call("GET", "/api/admin/transactions?type=payment&q=pay_LEDGER1", { cookie: adminCookie });
  assert.equal(payments.data.transactions.length, 1);
  const entry = payments.data.transactions[0];
  assert.equal(entry.status, "captured");
  const one = await call("GET", `/api/admin/transactions/${entry.id}`, { cookie: adminCookie });
  assert.equal(one.status, 200);
  assert.equal(one.data.entry.reference, "pay_LEDGER1");
  assert.equal((await call("GET", "/api/admin/transactions/pay_zzz", { cookie: adminCookie })).status, 404);
  assert.equal((await call("GET", `${ADMIN}/transactions/${entry.id}`, { cookie: adminCookie })).status, 200);

  const refunds = await call("GET", "/api/admin/refunds?status=processed", { cookie: adminCookie });
  assert.ok(refunds.data.refunds.length >= 2);
  assert.ok(refunds.data.refunds.every(r => r.status === "processed"));

  const rec = await call("GET", "/api/admin/transactions/reconciliation?days=7", { cookie: adminCookie });
  assert.equal(rec.status, 200);
  assert.equal(rec.data.rows.length, 7);
  assert.ok(rec.data.issues.some(i => i.kind === "paid_without_payment" && i.orderId === unmatched.orderId));
  assert.ok(rec.data.issues.some(i => i.kind === "cod_not_collected"));
  assert.ok(rec.data.mismatchedDays >= 1);
  for (const page of ["transactions", "transactions/reconciliation", "refunds"]) assert.equal((await call("GET", `${ADMIN}/${page}`, { cookie: adminCookie })).status, 200, page);
});

test("abandoned carts: listed after 24 hours, one reminder a day, opt-outs respected, recovery rate", async () => {
  const cart = await Cart.findOneAndUpdate({ user: customer._id }, { items: [{ product: shoe._id, quantity: 2 }] }, { upsert: true, new: true });
  // Too fresh: not abandoned yet.
  assert.equal((await call("GET", "/api/admin/abandoned-carts", { cookie: adminCookie })).data.carts.length, 0);
  const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
  await Cart.collection.updateOne({ _id: cart._id }, { $set: { updatedAt: twoDaysAgo } });
  const list = await call("GET", "/api/admin/abandoned-carts", { cookie: adminCookie });
  assert.equal(list.data.carts.length, 1);
  assert.equal(list.data.carts[0].value, shoe.price * 2);
  assert.equal(list.data.carts[0].canRemind, true);

  const sent = await call("POST", `/api/admin/abandoned-carts/${cart._id}/remind`, { cookie: adminCookie });
  assert.equal(sent.status, 200);
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].to, "asha@sales.test");
  assert.match(outbox[0].text, /Sales Trail Shoe × 2/);
  const saved = await Cart.findById(cart._id).lean();
  assert.ok(saved.reminderSentAt);
  assert.equal(saved.updatedAt.getTime(), twoDaysAgo.getTime()); // still abandoned
  assert.equal((await call("POST", `/api/admin/abandoned-carts/${cart._id}/remind`, { cookie: adminCookie })).status, 400); // once a day
  assert.ok(await AuditLog.findOne({ action: "cart.reminder" }));

  // An order after the reminder counts as recovered.
  await makeOrder();
  const stats = (await call("GET", "/api/admin/abandoned-carts", { cookie: adminCookie })).data.stats;
  assert.equal(stats.reminded, 1);
  assert.equal(stats.recovered, 1);
  assert.equal(stats.rate, 100);

  // Customers who turned off offer emails get none.
  await User.updateOne({ _id: customer._id }, { "notifyPrefs.offers": false });
  await Cart.collection.updateOne({ _id: cart._id }, { $set: { reminderSentAt: twoDaysAgo } });
  assert.equal((await call("POST", `/api/admin/abandoned-carts/${cart._id}/remind`, { cookie: adminCookie })).status, 400);
  assert.equal((await call("GET", `${ADMIN}/abandoned-carts`, { cookie: adminCookie })).status, 200);
  assert.equal((await call("POST", `/api/admin/abandoned-carts/${cart._id}/remind`, { cookie: customerCookie })).status, 401);
});
