// Shipping (B5): Shiprocket booking, PIN code checks, the tracking webhook and refused parcels (RTO).
// Shiprocket is replaced by a fake, so nothing is ever sent to it. The database tests have their own
// database ("_shipping") and run only when TEST_MONGODB_URI is set.
require("./helpers");
process.env.SHIPPING_PROVIDER = "shiprocket";
process.env.SHIPROCKET_EMAIL = "api@shop.test";
process.env.SHIPROCKET_PASSWORD = "not-a-real-password";
process.env.SHIPROCKET_PICKUP_LOCATION = "Kochi Warehouse";
process.env.SHIPROCKET_WEBHOOK_TOKEN = "webhook-token-for-tests-123";
process.env.SHIPPING_PICKUP_PINCODE = "682001";
const test = require("node:test");
const assert = require("node:assert/strict");
const shiprocket = require("../services/shipping/shiprocket");
const shippingService = require("../services/shippingService");
const { checkEnv } = require("../config/schema");

// A fake Shiprocket: answers by path and records every call.
function fakeShiprocket(routes) {
  const calls = [];
  shiprocket.setTransport(async (url, options) => {
    const path = url.replace("https://apiv2.shiprocket.in/v1/external", "");
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ path, method: options.method, body, auth: options.headers.Authorization || "" });
    const key = Object.keys(routes).find(prefix => path.startsWith(prefix));
    const [status, data] = key ? routes[key](body, calls) : [404, { message: "Not found" }];
    return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(data) };
  });
  return calls;
}

test("shipping: courier words move the order along, and nothing else does", () => {
  const map = shippingService.mapCourierStatus;
  assert.deepEqual(map("PICKED UP"), { status: "shipped" });
  assert.deepEqual(map("In Transit"), { status: "shipped" });
  assert.deepEqual(map("OUT FOR DELIVERY"), { status: "out_for_delivery" });
  assert.deepEqual(map("DELIVERED"), { status: "delivered" });
  assert.deepEqual(map("RTO INITIATED"), { rto: "initiated" });
  assert.deepEqual(map("RTO IN TRANSIT"), { rto: "initiated" });
  assert.deepEqual(map("RTO DELIVERED"), { rto: "received" }, "back with us is not a delivery to the customer");
  assert.deepEqual(map("UNDELIVERED"), { attempt: true });
  assert.equal(map("PICKUP SCHEDULED"), null);
  assert.equal(map(""), null);
});

test("shipping: the webhook token is checked exactly", () => {
  assert.equal(shippingService.webhookAuthorised("webhook-token-for-tests-123"), true);
  assert.equal(shippingService.webhookAuthorised("webhook-token-for-tests-124"), false);
  assert.equal(shippingService.webhookAuthorised(""), false);
  assert.equal(shippingService.webhookAuthorised(undefined), false);
});

test("shipping: Shiprocket's times are India time", () => {
  assert.equal(shippingService.parseAt("2026-11-14 10:30:00").toISOString(), "2026-11-14T05:00:00.000Z");
  assert.equal(shiprocket.istStamp(new Date("2026-11-14T05:00:00Z")), "2026-11-14 10:30");
});

test("shipping: settings must be complete before Shiprocket is used", () => {
  const base = { NODE_ENV: "development", MONGODB_URI: "mongodb://127.0.0.1/x", JWT_SECRET: "x".repeat(40) };
  const errors = env => checkEnv({ ...base, ...env }).errors.join("\n");
  assert.match(errors({ SHIPPING_PROVIDER: "fedex" }), /SHIPPING_PROVIDER/);
  const missing = errors({ SHIPPING_PROVIDER: "shiprocket" });
  assert.match(missing, /SHIPROCKET_EMAIL/);
  assert.match(missing, /SHIPPING_PICKUP_PINCODE/);
  assert.doesNotMatch(errors({ SHIPPING_PROVIDER: "manual" }), /SHIP/);
});

test("shipping: the parcel says what to collect: the amount due for COD, the goods' value when prepaid", () => {
  const order = {
    orderId: "NX-1", createdAt: new Date("2026-11-14T05:00:00Z"), paymentMethod: "cod", paymentStatus: "pending",
    total: 109800, deliveryFee: 4900, couponDiscount: 10000, walletUsed: 0,
    address: { fullName: "Asha Mary Thomas", phone: "9876543210", line1: "12 MG Road", line2: "Flat 4", landmark: "Near park", city: "Kochi", state: "Kerala", pincode: "682001" },
    items: [
      { product: "p1", name: "Match Ball", option: "Size 5", sku: "MB-5", price: 59900, quantity: 2, lineTotal: 119800, status: "placed" },
      { product: "p2", name: "Pump", price: 9900, quantity: 1, lineTotal: 9900, status: "cancelled" }
    ]
  };
  const parcel = shiprocket.parcelFor(order, { email: "asha@shop.test" }, new Map([["p1", 450]]));
  assert.equal(parcel.payment_method, "COD");
  assert.equal(parcel.sub_total, 1098);
  assert.equal(parcel.billing_customer_name, "Asha");
  assert.equal(parcel.billing_last_name, "Mary Thomas");
  assert.equal(parcel.billing_address_2, "Flat 4, Near park");
  assert.equal(parcel.order_items.length, 1, "cancelled items are not in the parcel");
  assert.deepEqual(parcel.order_items[0], { name: "Match Ball (Size 5)", sku: "MB-5", units: 2, selling_price: 599, hsn: "" });
  assert.equal(parcel.weight, 0.9, "450 g each, two of them");
  assert.equal(parcel.pickup_location, "Kochi Warehouse");

  const prepaid = shiprocket.parcelFor({ ...order, paymentMethod: "razorpay", paymentStatus: "paid" }, null, new Map());
  assert.equal(prepaid.payment_method, "Prepaid");
  assert.equal(prepaid.sub_total, 1198);
  assert.equal(prepaid.weight, 1, "the store default (0.5 kg) when a product has no weight");
});

test("shipping: booking logs in once, takes the AWB, asks for a pickup and keeps the label", async () => {
  const calls = fakeShiprocket({
    "/auth/login": () => [200, { token: "tok-1" }],
    "/orders/create/adhoc": () => [200, { order_id: 9001, shipment_id: 7001, status: "NEW" }],
    "/courier/assign/awb": () => [200, { awb_assign_status: 1, response: { data: { awb_code: "AWB123456", courier_name: "Delhivery Surface" } } }],
    "/courier/generate/pickup": () => [200, { pickup_status: 1 }],
    "/courier/generate/label": () => [200, { label_created: 1, label_url: "https://labels.example.com/7001.pdf" }]
  });
  const order = { orderId: "NX-2", paymentMethod: "cod", paymentStatus: "pending", total: 59900, address: { fullName: "Ravi", line1: "1 Road", city: "Pune", state: "Maharashtra", pincode: "411001", phone: "9876500000" }, items: [{ product: "p1", name: "Ball", price: 59900, quantity: 1, lineTotal: 59900, status: "placed" }] };
  const booked = await shiprocket.book(order, null, new Map());
  assert.deepEqual(booked, { courier: "Delhivery Surface", trackingNumber: "AWB123456", providerOrderId: "9001", providerShipmentId: "7001", labelUrl: "https://labels.example.com/7001.pdf" });
  assert.deepEqual(calls.map(c => c.path), ["/auth/login", "/orders/create/adhoc", "/courier/assign/awb", "/courier/generate/pickup", "/courier/generate/label"]);
  assert.ok(calls.slice(1).every(c => c.auth === "Bearer tok-1"));

  // A second booking reuses the token; an expired one is renewed once.
  let first = true;
  const again = fakeShiprocket({
    "/auth/login": () => [200, { token: "tok-2" }],
    "/orders/create/adhoc": () => {
      if (first) { first = false; return [401, { message: "Token expired" }]; }
      return [200, { order_id: 9002, shipment_id: 7002 }];
    },
    "/courier/assign/awb": () => [200, { response: { data: {} } }]
  });
  await assert.rejects(shiprocket.book(order, null, new Map()), error => error.reason === "shipping_no_courier");
  assert.deepEqual(again.map(c => c.path), ["/auth/login", "/orders/create/adhoc", "/auth/login", "/orders/create/adhoc", "/courier/assign/awb"]);
});

test("shipping: PIN codes are confirmed with the courier platform, and the rules step in when it is down", async () => {
  shippingService._pinCache.clear();
  let asked = 0;
  fakeShiprocket({
    "/auth/login": () => [200, { token: "tok" }],
    "/courier/serviceability/": () => {
      asked += 1;
      return [200, { data: { available_courier_companies: [{ courier_name: "A", estimated_delivery_days: "3", cod: 1 }, { courier_name: "B", estimated_delivery_days: "5", cod: 0 }] } }];
    }
  });
  const yes = await shippingService.checkPincode("560038");
  assert.equal(yes.deliverable, true);
  assert.equal(yes.cod, true);
  assert.equal(yes.checked, "courier");
  await shippingService.checkPincode("560038");
  assert.equal(asked, 1, "answers are kept for a while");

  fakeShiprocket({ "/auth/login": () => [200, { token: "tok" }], "/courier/serviceability/": () => [404, { message: "No courier" }] });
  const no = await shippingService.checkPincode("110001");
  assert.equal(no.deliverable, false);
  assert.match(no.reason, /don't deliver/);

  shiprocket.setTransport(async () => { throw new Error("socket hang up"); });
  const fallback = await shippingService.checkPincode("400001");
  assert.equal(fallback.deliverable, true);
  assert.equal(fallback.checked, "rules");
  assert.equal((await shippingService.checkPincode("990001")).deliverable, false, "Army post codes never reach the courier");
});

if (!process.env.TEST_MONGODB_URI) {
  test("shipping database tests (set TEST_MONGODB_URI to run them)", { skip: true }, () => {});
  return;
}

const mongoose = require("mongoose");
const app = require("../app");
const Product = require("../models/Product");
const Order = require("../models/Order");
const User = require("../models/User");
const Wallet = require("../models/Wallet");
const categoryService = require("../services/categoryService");

const dbUrl = new URL(process.env.TEST_MONGODB_URI);
dbUrl.pathname = `${dbUrl.pathname.replace(/\/$/, "")}_shipping`;
let server;
let base;
let ball;
let buyer;
let seq = 0;

async function makeOrder(extra = {}) {
  seq += 1;
  const order = await Order.create({
    orderId: `NX-SHIP-${seq}`, user: buyer._id,
    items: [{ product: ball._id, name: ball.name, slug: ball.slug, price: 59900, mrp: 69900, quantity: 2, lineTotal: 119800, status: "shipped" }],
    address: { fullName: "Ship Buyer", phone: "9876543210", line1: "12 MG Road", city: "Kochi", state: "Kerala", pincode: "682001" },
    mrpTotal: 139800, subtotal: 119800, total: 119800, paymentMethod: "cod", paymentStatus: "pending", orderStatus: "shipped", stockReserved: true,
    statusHistory: [{ status: "placed" }, { status: "shipped" }],
    shipments: [{ courier: "Delhivery", trackingNumber: `AWB-${seq}`, provider: "shiprocket" }],
    ...extra
  });
  return order;
}

const hook = (body, token = "webhook-token-for-tests-123") => fetch(`${base}/api/webhooks/courier`, {
  method: "POST", headers: { "Content-Type": "application/json", ...(token ? { "x-api-key": token } : {}) }, body: JSON.stringify(body)
});

test.before(async () => {
  if (!/test/i.test(dbUrl.pathname)) throw new Error("The shipping test database must have 'test' in its name.");
  await mongoose.connect(dbUrl.href);
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map(model => model.syncIndexes()));
  const football = await categoryService.ensureCategory("Football");
  categoryService.invalidate();
  ball = await Product.create({ name: "Ship Match Ball", slug: "ship-match-ball", category: football._id, brand: "Nexthlon", basePrice: 59900, mrp: 69900, stock: 10, image: "/img/favicon.svg", shipWeight: 450 });
  buyer = await User.create({ name: "Ship Buyer", email: "ship.buyer@shipping.test", passwordHash: "x".repeat(60) });
  server = app.listen(0);
  await new Promise(resolve => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  await new Promise(resolve => server.close(resolve));
});

test("shipping: the courier's updates move the order to the customer's door, and COD is paid on delivery", async () => {
  const order = await makeOrder();
  assert.equal((await hook({ awb: "AWB-1", current_status: "DELIVERED" }, "wrong-token")).status, 401);
  assert.equal((await hook({ awb: "AWB-1", current_status: "DELIVERED" }, "")).status, 401);
  assert.equal((await hook({ awb: "NOPE", current_status: "DELIVERED" })).status, 200, "an unknown parcel is acknowledged, so it is not resent forever");

  const scans = [
    { date: "2026-11-14 09:00:00", activity: "Picked up", location: "Kochi Hub", "sr-status-label": "PICKED UP" },
    { date: "2026-11-15 07:30:00", activity: "Out for delivery", location: "Pune DC", "sr-status-label": "OUT FOR DELIVERY" }
  ];
  assert.equal((await hook({ awb: "AWB-1", current_status: "OUT FOR DELIVERY", current_timestamp: "2026-11-15 07:30:00", scans })).status, 200);
  let saved = await Order.findById(order._id);
  assert.equal(saved.orderStatus, "out_for_delivery");
  assert.equal(saved.shipments[0].status, "OUT FOR DELIVERY");
  assert.equal(saved.shipments[0].events.length, 2, "the same scan sent twice is kept once");
  assert.equal(saved.shipments[0].events[0].location, "Kochi Hub");

  // The full list again plus one: only the new scan is added.
  await hook({ awb: "AWB-1", current_status: "DELIVERED", current_timestamp: "2026-11-15 12:00:00", scans: [...scans, { date: "2026-11-15 12:00:00", "sr-status-label": "DELIVERED", location: "Pune" }] });
  saved = await Order.findById(order._id);
  assert.equal(saved.orderStatus, "delivered");
  assert.equal(saved.paymentStatus, "paid", "the courier collected the cash");
  assert.equal(saved.shipments[0].events.length, 3);
  assert.ok(saved.statusHistory.some(h => h.status === "delivered" && h.by === "system"));

  // A late, older update never moves a delivered order back.
  await hook({ awb: "AWB-1", current_status: "IN TRANSIT" });
  assert.equal((await Order.findById(order._id)).orderStatus, "delivered");

  const tracking = shippingService.trackingFor(saved);
  assert.equal(tracking.trackingNumber, "AWB-1");
  assert.equal(tracking.events[0].status, "Delivered", "newest first, in plain words");
  assert.equal(shippingService.sentence("RTO IN TRANSIT"), "RTO in transit");
});

test("shipping: a refused parcel comes back, then its items are cancelled, stock returns and a prepaid order is refunded", async () => {
  await Wallet.deleteMany({ user: buyer._id });
  const stockBefore = (await Product.findById(ball._id)).stock;
  const order = await makeOrder({ paymentMethod: "wallet", paymentStatus: "paid", walletUsed: 119800, total: 0 });
  await hook({ awb: order.shipments[0].trackingNumber, current_status: "RTO INITIATED" });
  let saved = await Order.findById(order._id);
  assert.equal(saved.rto.stage, "initiated");
  assert.equal(saved.orderStatus, "shipped", "still with the courier");

  await hook({ awb: order.shipments[0].trackingNumber, current_status: "RTO DELIVERED" });
  saved = await Order.findById(order._id);
  assert.equal(saved.rto.stage, "received");
  assert.equal(saved.orderStatus, "cancelled");
  assert.match(saved.items[0].cancelReason, /could not deliver/);
  assert.equal((await Product.findById(ball._id)).stock, stockBefore + 2, "both balls are back on the shelf");
  assert.equal(saved.refundedAmount, 119800, "the wallet payment is refunded");
  const wallet = await Wallet.findOne({ user: buyer._id }).lean();
  assert.equal(wallet.balance, 119800);

  // Sent again (couriers repeat themselves): nothing happens twice.
  await hook({ awb: order.shipments[0].trackingNumber, current_status: "RTO DELIVERED" });
  assert.equal((await Wallet.findOne({ user: buyer._id }).lean()).balance, 119800);
});

test("shipping: one click books the parcel, records the AWB and label, and marks the order as shipped", async () => {
  const calls = fakeShiprocket({
    "/auth/login": () => [200, { token: "tok" }],
    "/orders/create/adhoc": body => [200, { order_id: 1, shipment_id: 2, echo: body }],
    "/courier/assign/awb": () => [200, { response: { data: { awb_code: "AWB-ONE-CLICK", courier_name: "Blue Dart" } } }],
    "/courier/generate/pickup": () => [200, {}],
    "/courier/generate/label": () => [200, { label_url: "https://labels.example.com/2.pdf" }]
  });
  const order = await makeOrder({ orderStatus: "confirmed", shipments: [], items: [{ product: ball._id, name: ball.name, slug: ball.slug, price: 59900, mrp: 69900, quantity: 1, lineTotal: 59900, status: "confirmed" }], total: 59900 });
  const { shipment } = await shippingService.shipOrder(order.orderId, { _id: buyer._id });
  assert.equal(shipment.trackingNumber, "AWB-ONE-CLICK");
  assert.equal(shipment.labelUrl, "https://labels.example.com/2.pdf");
  const saved = await Order.findById(order._id);
  assert.equal(saved.orderStatus, "shipped");
  await assert.rejects(shippingService.shipOrder(order.orderId, { _id: buyer._id }), /already shipped|already booked/);
  assert.equal(calls.find(c => c.path === "/orders/create/adhoc").body.weight, 0.45, "the parcel weight came from the product");
});
