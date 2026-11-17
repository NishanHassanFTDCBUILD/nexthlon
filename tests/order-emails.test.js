require("./helpers");
const test = require("node:test");
const assert = require("node:assert/strict");
if (!process.env.TEST_MONGODB_URI) {
  test("order email database tests (set TEST_MONGODB_URI to run them)", { skip: true }, () => {});
  return;
}
const mongoose = require("mongoose");
const User = require("../models/User");
const Order = require("../models/Order");
const Job = require("../models/Job");
const EmailLog = require("../models/EmailLog");
const mailService = require("../services/mailService");
const orderService = require("../services/orderService");
const adminOrderService = require("../services/adminOrderService");
const refundService = require("../services/refundService");
const orderMail = require("../services/orderMailService");
const { createWorker } = require("../jobs/worker");
require("../jobs/handlers");

const dbUrl = new URL(process.env.TEST_MONGODB_URI);
dbUrl.pathname = `${dbUrl.pathname.replace(/\/$/, "")}_orderemails`;

let outbox;
let customer;
let seq = 0;
const worker = createWorker();
const drain = () => worker.drain();
const subjects = () => outbox.map(mail => mail.subject);

async function makeOrder(fields = {}) {
  seq += 1;
  const price = 300000;
  return Order.create({
    orderId: `NX-2026-${String(500000 + seq)}`,
    user: customer._id,
    items: [{ product: new mongoose.Types.ObjectId(), name: "Trail Shoe", slug: "trail-shoe", brand: "Nexthlon", price, mrp: 400000, quantity: 2, lineTotal: price * 2, status: fields.itemStatus || "placed", image: "/uploads/shoe.webp" }],
    address: { fullName: "Asha Nair", phone: "9876543210", line1: "1 Beach Road", city: "Kochi", state: "Kerala", pincode: "682001" },
    mrpTotal: 800000,
    subtotal: price * 2,
    total: price * 2,
    paymentMethod: fields.paymentMethod || "cod",
    paymentStatus: fields.paymentStatus || "pending",
    orderStatus: fields.orderStatus || "placed",
    stockReserved: true,
    statusHistory: []
  });
}

test.before(async () => {
  if (!/test/i.test(dbUrl.pathname)) throw new Error("The test database must have 'test' in its name.");
  await mongoose.connect(dbUrl.href);
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map(model => model.syncIndexes()));
  outbox = [];
  mailService.useTestOutbox(outbox);
  customer = await User.create({ name: "Asha Nair", email: "asha@emails.test", passwordHash: "x", role: "customer" });
});
test.beforeEach(async () => {
  outbox.length = 0;
  await Job.deleteMany({});
  await EmailLog.deleteMany({});
  await User.updateOne({ _id: customer._id }, { "notifyPrefs.orderUpdates": true });
});
test.after(async () => {
  mailService.useTestOutbox(null);
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

const send = (kind, order, extra, suffix) => orderMail.sendOrderEmail(kind, order.orderId, extra, suffix);

// ---------- one test per email ----------

test("confirmed: items, payment and address, with a button and plain-text twin", async () => {
  const order = await makeOrder();
  assert.equal(await send("placed", order), "sent");
  const mail = outbox[0];
  assert.equal(mail.to, "asha@emails.test");
  assert.equal(mail.subject, `Order ${order.orderId} confirmed: thank you!`);
  assert.match(mail.html, /Trail Shoe/);
  assert.match(mail.html, /Delivering to/);
  assert.match(mail.html, /1 Beach Road/);
  assert.match(mail.html, /http:\/\/localhost:\d+\/uploads\/shoe/, "photos are full addresses an email app can load");
  assert.match(mail.text, /Trail Shoe/);
  assert.match(mail.text, /₹6,000/);
});

test("shipped: carries the courier and tracking number", async () => {
  const order = await makeOrder({ orderStatus: "shipped", itemStatus: "shipped" });
  order.shipments.push({ courier: "Blue Dart", trackingNumber: "BD123456", expectedAt: new Date(Date.now() + 3 * 864e5) });
  await order.save();
  await send("shipped", order);
  assert.equal(outbox[0].subject, `Your order ${order.orderId} has shipped`);
  assert.match(outbox[0].html, /Blue Dart/);
  assert.match(outbox[0].text, /BD123456/);
});

test("out for delivery: cash orders are told how much to keep ready", async () => {
  const order = await makeOrder({ orderStatus: "out_for_delivery", itemStatus: "out_for_delivery" });
  await send("out_for_delivery", order);
  assert.equal(outbox[0].subject, `Arriving today: order ${order.orderId}`);
  assert.match(outbox[0].text, /₹6,000/);
});

test("delivered: invoice link and the return window", async () => {
  const order = await makeOrder({ orderStatus: "delivered", itemStatus: "delivered" });
  await send("delivered", order);
  assert.equal(outbox[0].subject, `Delivered: order ${order.orderId}`);
  assert.match(outbox[0].text, /invoice/);
});

test("tracking added later: its own email", async () => {
  const order = await makeOrder({ orderStatus: "shipped", itemStatus: "shipped" });
  order.shipments.push({ courier: "DTDC", trackingNumber: "D777" });
  await order.save();
  await send("tracking", order, {}, "s1");
  assert.equal(outbox[0].subject, `Tracking details for order ${order.orderId}`);
  assert.match(outbox[0].text, /D777/);
});

test("cancelled: says what was cancelled", async () => {
  const order = await makeOrder();
  await send("cancelled", order, { itemIds: [String(order.items[0]._id)], reason: "Changed my mind" }, "x");
  assert.match(outbox[0].subject, /cancelled/i);
  assert.match(outbox[0].text, /Changed my mind/);
  assert.match(outbox[0].text, /Trail Shoe/);
});

test("refunded: says the amount and where it went", async () => {
  const order = await makeOrder({ orderStatus: "cancelled" });
  await send("refunded", order, { amount: 600000, parts: [{ amount: 600000, method: "wallet", status: "processed" }] }, "1");
  assert.equal(outbox[0].subject, `Refund of ₹6,000 for order ${order.orderId}`);
  assert.match(outbox[0].text, /wallet/i);
});

test("return requested and return decided (approved and declined)", async () => {
  const order = await makeOrder({ orderStatus: "delivered", itemStatus: "return_requested" });
  await send("return_requested", order, {}, "1");
  assert.match(outbox[0].subject, /return request/i);
  await send("return_decided", order, { decision: "approve", note: "Pickup tomorrow" }, "2");
  assert.equal(outbox[1].subject, `Return approved for order ${order.orderId}`);
  assert.match(outbox[1].text, /Pickup tomorrow/);
  await send("return_decided", order, { decision: "reject", note: "Worn shoes" }, "3");
  assert.equal(outbox[2].subject, `Update on your return for order ${order.orderId}`);
  assert.match(outbox[2].text, /Worn shoes/);
});

test("customer text is escaped in the HTML", async () => {
  const order = await makeOrder();
  await send("cancelled", order, { itemIds: [], reason: "<script>alert(1)</script>" }, "esc");
  assert.ok(!outbox[0].html.includes("<script>alert(1)"));
});

// ---------- exactly once, opt-outs, retries ----------

test("the same email is sent once, however many times it is asked", async () => {
  const order = await makeOrder();
  assert.equal(await send("placed", order), "sent");
  assert.equal(await send("placed", order), "skipped");
  assert.equal(await Promise.allSettled([send("placed", order), send("placed", order)]).then(r => r.length), 2);
  assert.equal(outbox.length, 1);
});

test("two workers sending the same email at once: one email", async () => {
  const order = await makeOrder();
  const results = await Promise.allSettled(Array.from({ length: 5 }, () => send("placed", order)));
  assert.equal(outbox.length, 1);
  assert.ok(results.every(r => r.status === "fulfilled" || /Another worker/.test(r.reason.message)));
});

test("a failed send is retried by the queue and arrives once", async () => {
  const order = await makeOrder();
  let attempts = 0;
  const failing = { send: async message => { attempts += 1; if (attempts === 1) throw new Error("provider down"); outbox.push(message); return { id: "ok" }; } };
  mailService.useTestOutbox(null);
  mailService.useProviderForTests(failing);
  try {
    // Provider injected in test mode: the real send path runs with the fake provider.
    await orderMail_placedViaEvents(order);
    assert.equal(outbox.length, 0);
    const job = await Job.findOne({ type: "event:order.placed:email" });
    assert.equal(job.status, "queued");
    assert.match(job.lastError, /could not be sent/);
    await Job.updateOne({ _id: job._id }, { runAt: new Date(Date.now() - 1000) });
    await drain();
    assert.equal(outbox.length, 1);
    assert.equal((await Job.findOne({ type: "event:order.placed:email" })).status, "done");
  } finally {
    mailService.useProviderForTests(null);
    mailService.useTestOutbox(outbox);
  }
});

async function orderMail_placedViaEvents(order) {
  const events = require("../events");
  await events.emit("order.placed", { orderId: order.orderId }, { key: order.orderId });
  await drain();
}

test("a restart in the middle of sending: the half-done claim is taken over after its lease, and nobody gets two", async () => {
  const order = await makeOrder();
  // The worker died after claiming but before sending.
  await EmailLog.create({ key: `order:${order.orderId}:placed`, kind: "placed", to: "asha@emails.test", orderId: order.orderId, claimedAt: new Date() });
  await assert.rejects(send("placed", order), /Another worker/);
  await EmailLog.updateOne({ key: `order:${order.orderId}:placed` }, { claimedAt: new Date(Date.now() - 10 * 60 * 1000) });
  assert.equal(await send("placed", order), "sent");
  assert.equal(outbox.length, 1);
});

test("delivery updates follow the Order updates switch; receipts and refunds always go", async () => {
  await User.updateOne({ _id: customer._id }, { "notifyPrefs.orderUpdates": false });
  const order = await makeOrder({ orderStatus: "shipped", itemStatus: "shipped" });
  assert.equal(await send("shipped", order), "opted-out");
  assert.equal(await send("delivered", order), "opted-out");
  assert.equal(await send("placed", order), "sent");
  assert.equal(await send("refunded", order, { amount: 100, parts: [] }, "1"), "sent");
  assert.equal(outbox.length, 2);
});

test("a deleted customer or missing order gets nothing", async () => {
  assert.equal(await orderMail.sendOrderEmail("placed", "NX-NOPE"), "missing");
  assert.equal(outbox.length, 0);
});

// ---------- through the real order flows ----------

test("status changes send one email each: shipped, out for delivery, delivered (confirmed sends none)", async () => {
  const order = await makeOrder();
  for (const status of ["confirmed", "shipped", "out_for_delivery", "delivered"]) await orderService.advanceStatus(await Order.findById(order._id), status);
  await drain();
  assert.deepEqual(subjects().sort(), [
    `Arriving today: order ${order.orderId}`,
    `Delivered: order ${order.orderId}`,
    `Your order ${order.orderId} has shipped`
  ].sort());
  // Running the worker again, or asking for the same status again, sends nothing more.
  await drain();
  assert.equal(outbox.length, 3);
});

test("jumping straight from placed to delivered still sends one delivered email", async () => {
  const order = await makeOrder();
  await orderService.advanceStatus(await Order.findById(order._id), "delivered");
  await drain();
  assert.deepEqual(subjects(), [`Delivered: order ${order.orderId}`]);
});

test("cancelling an order emails once", async () => {
  const order = await makeOrder();
  await orderService.cancelItems(await Order.findById(order._id), (await Order.findById(order._id)).items, { reason: "Ordered by mistake" });
  await drain();
  assert.equal(subjects().filter(s => /cancelled/i.test(s)).length, 1);
});

test("a refund emails once, even when the money goes to two places", async () => {
  const order = await makeOrder({ orderStatus: "cancelled", paymentMethod: "cod", paymentStatus: "paid" });
  await refundService.issueRefund(await Order.findById(order._id), 600000, { method: "wallet", reason: "Cancelled" });
  await drain();
  assert.equal(subjects().filter(s => /^Refund of/.test(s)).length, 1);
});

test("adding tracking to an order not yet shipped sends nothing; after shipping it sends the tracking email", async () => {
  const admin = await User.create({ name: "Admin", email: "admin@emails.test", passwordHash: "x", role: "admin" });
  const early = await makeOrder();
  await adminOrderService.addShipment(early.orderId, { courier: "Blue Dart", trackingNumber: "BD1" }, admin);
  await drain();
  assert.equal(outbox.length, 0);
  const late = await makeOrder({ orderStatus: "shipped", itemStatus: "shipped" });
  await adminOrderService.addShipment(late.orderId, { courier: "DTDC", trackingNumber: "D2" }, admin);
  await drain();
  assert.deepEqual(subjects(), [`Tracking details for order ${late.orderId}`]);
});

test("events are saved as jobs, so a restart between the change and the email loses nothing", async () => {
  const order = await makeOrder();
  await orderService.advanceStatus(await Order.findById(order._id), "shipped");
  assert.equal(outbox.length, 0, "the request does not wait for the email");
  assert.equal(await Job.countDocuments({ type: "event:order.status_changed:email", status: "queued" }), 1);
  // "Restart": a brand-new worker finds the saved job.
  await createWorker().drain();
  assert.equal(outbox.length, 1);
});
