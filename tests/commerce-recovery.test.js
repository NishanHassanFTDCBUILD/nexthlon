// Fault-injection tests run the real services with an in-memory order store.
// The separate database suite verifies MongoDB's atomic receipts and versioning.
require("./helpers");
const test = require("node:test");
const assert = require("node:assert/strict");
const Order = require("../models/Order");
const Cart = require("../models/Cart");
const stock = require("../services/stockService");
const wallet = require("../services/walletService");
const refunds = require("../services/refundService");
const payments = require("../services/paymentService");
const orders = require("../services/orderService");
const settlements = require("../services/settlementService");
const gst = require("../services/gstService");
const gateway = require("../services/razorpayService");
const events = require("../events");
const copy = value => JSON.parse(JSON.stringify(value));
const id = "64b000000000000000000001";
const user = "64b000000000000000000002";

function fixture(t, overrides = {}) {
  let state = new Order({ _id: id, __v: 0, orderId: "NX-2026-000001", user,
    items: [{ _id: "64b000000000000000000003", product: "64b000000000000000000004", name: "Ball", slug: "ball", price: 10000, mrp: 10000, quantity: 1, lineTotal: 10000 }],
    address: { fullName: "Test Customer" }, mrpTotal: 10000, subtotal: 10000, total: 10000,
    paymentMethod: "wallet", paymentStatus: "paid", stockReserved: true,
    razorpay: { orderId: "order_test", paymentId: "pay_test" }, ...overrides }).toObject();
  state = copy(state);
  const counters = { credited: 0, stockTaken: 0, stockReturned: 0, invoices: 0, events: 0, gatewayCalls: 0 };
  const credited = new Set(), returned = new Set(), taken = new Set();
  let fail = {};
  const doc = () => {
    const document = Order.hydrate(copy(state));
    document.save = async () => {
      if (fail.save) { fail.save = false; throw new Error("injected order save failure"); }
      if (document.__v !== state.__v) throw Object.assign(new Error("concurrent update"), { name: "VersionError" });
      document.__v += 1;
      state = copy(document.toObject());
      return document;
    };
    return document;
  };
  function matches(filter) {
    return Object.entries(filter).every(([field, condition]) => {
      if (field === "refundOperations") {
        const match = wanted => state.refundOperations.some(op => Object.entries(wanted).every(([key, value]) => op[key] === value));
        return condition.$not ? !match(condition.$not.$elemMatch) : match(condition.$elemMatch);
      }
      const values = field.includes(".") && Array.isArray(state[field.split(".")[0]])
        ? state[field.split(".")[0]].map(op => op[field.split(".")[1]])
        : [field.split(".").reduce((obj, key) => obj && obj[key], state)];
      if (condition && condition.$in) return values.some(value => condition.$in.includes(value));
      return values.some(value => String(value) === String(condition));
    });
  }
  function apply(filter, change) {
    if (!matches(filter)) return false;
    if (fail.record && change.$inc && change.$inc.refundedAmount) { fail.record = false; throw new Error("injected refund history failure"); }
    const key = filter["refundOperations.key"] || filter.refundOperations?.$elemMatch?.key;
    const settlementKey = filter["settlements.key"];
    for (const [field, value] of Object.entries(change.$set || {})) {
      const parts = field.split(".");
      let target = state;
      for (let i = 0; i < parts.length - 1; i++) {
        target = parts[i] === "$" ? target.find(op => op.key === (key || settlementKey)) : target[parts[i]];
      }
      target[parts.at(-1)] = copy(value);
    }
    for (const [field, value] of Object.entries(change.$inc || {})) state[field] = (state[field] || 0) + value;
    for (const [field, value] of Object.entries(change.$push || {})) state[field].push(...copy(value.$each || [value]));
    // Apply subdocument defaults just as the model's query casting does.
    state = copy(new Order(state).toObject());
    return true;
  }
  t.mock.method(Order, "findById", () => Promise.resolve(doc()));
  t.mock.method(Order, "findOne", filter => Promise.resolve(matches(filter) ? doc() : null));
  t.mock.method(Order, "findOneAndUpdate", async (filter, change) => apply(filter, change) ? doc() : null);
  t.mock.method(Order, "updateOne", async (filter, change) => ({ modifiedCount: apply(filter, change) ? 1 : 0 }));
  t.mock.method(Cart, "updateOne", async () => ({}));
  t.mock.method(wallet, "credit", async (_user, amount, { key }) => {
    if (!credited.has(key)) { credited.add(key); counters.credited += amount; }
  });
  t.mock.method(stock, "takeStockOnce", async (_lines, key) => {
    if (fail.stock) { const error = fail.stock; fail.stock = null; throw error; }
    if (!taken.has(key)) { taken.add(key); counters.stockTaken++; }
  });
  t.mock.method(stock, "returnStockOnce", async (_lines, key) => {
    if (!returned.has(key)) { returned.add(key); counters.stockReturned++; }
    if (fail.restore) { fail.restore = false; throw new Error("injected response lost after stock return"); }
  });
  t.mock.method(gst, "issueInvoice", async () => { counters.invoices++; if (fail.invoice) { fail.invoice = false; throw new Error("injected invoice failure"); } });
  t.mock.method(gst, "syncCreditNotes", async () => {});
  t.mock.method(events, "emit", async () => { counters.events++; if (fail.event) { fail.event = false; return false; } return true; });
  t.mock.method(gateway, "refundPayment", async (_payment, amount) => {
    counters.gatewayCalls++;
    if (fail.gateway) throw new Error("injected lost gateway response");
    return { id: "rfnd_test", amount, status: "processed" };
  });
  t.mock.method(gateway, "findRefund", async () => fail.reconcile ? null : ({ id: "rfnd_test", amount: 10000, status: "processed" }));
  return { counters, fail, doc, state: () => state };
}

test("refund retry after order history failure credits the wallet once", async t => {
  const f = fixture(t); f.fail.record = true;
  await assert.rejects(refunds.issueRefund(f.doc(), 10000, { key: "cancel-test" }), /history failure/);
  assert.equal(f.counters.credited, 10000);
  await refunds.issueRefund(f.doc(), 10000, { key: "cancel-test" });
  await refunds.issueRefund(f.doc(), 10000, { key: "cancel-test" });
  assert.equal(f.counters.credited, 10000);
  assert.equal(f.state().refundedAmount, 10000);
  assert.equal(f.state().refunds.length, 1);
  assert.equal(f.state().paymentStatus, "refunded");
});

test("an uncertain original refund reconciles without another payment or wallet fallback", async t => {
  const f = fixture(t, { paymentMethod: "razorpay" }); f.fail.gateway = true;
  await assert.rejects(refunds.issueRefund(f.doc(), 10000, { method: "original", key: "original-test" }), error => error.reason === "refund_pending");
  await refunds.issueRefund(f.doc(), 10000, { method: "original", key: "original-test" });
  assert.equal(f.counters.gatewayCalls, 1);
  assert.equal(f.counters.credited, 0);
  assert.equal(f.state().refundedAmount, 10000);
  assert.equal(f.state().refunds[0].razorpayRefundId, "rfnd_test");
});

test("an unconfirmed gateway outcome remains pending without moving more money", async t => {
  const f = fixture(t, { paymentMethod: "razorpay" }); f.fail.gateway = true; f.fail.reconcile = true;
  for (let i = 0; i < 2; i++) await assert.rejects(refunds.issueRefund(f.doc(), 10000, { method: "original", key: "unknown-test" }));
  assert.equal(f.counters.gatewayCalls, 1);
  assert.equal(f.counters.credited, 0);
  assert.equal(f.state().refundedAmount, 0);
  assert.equal(f.state().refundOperations[0].done, false);
});

test("concurrent refunds cannot exceed the remaining paid amount", async t => {
  const f = fixture(t);
  const results = await Promise.allSettled([refunds.issueRefund(f.doc(), 6000, { key: "a" }), refunds.issueRefund(f.doc(), 6000, { key: "b" })]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(f.state().refundedAmount, 6000);
  assert.equal(f.counters.credited, 6000);
});

test("a mixed refund resumes both legs without duplicate gateway or wallet movement", async t => {
  const f = fixture(t, { paymentMethod: "razorpay", total: 6000, walletUsed: 4000 }); f.fail.record = true;
  await assert.rejects(refunds.issueRefund(f.doc(), 10000, { method: "original", key: "mixed" }));
  await refunds.issueRefund(f.doc(), 10000, { method: "original", key: "mixed" });
  assert.equal(f.counters.gatewayCalls, 1);
  assert.equal(f.counters.credited, 4000);
  assert.equal(f.state().refundedAmount, 10000);
  assert.deepEqual(f.state().refunds.map(part => [part.method, part.amount]), [["original", 6000], ["wallet", 4000]]);
});

test("a new manual refund cannot consume money reserved for a saved cancellation", async t => {
  const f = fixture(t); f.fail.restore = true;
  const order = f.doc();
  await assert.rejects(orders.cancelItems(order, [...order.items]));
  await assert.rejects(refunds.issueRefund(f.doc(), 6000, { key: "manual-other" }), error => error.status === 409);
  await settlements.resume(id);
  assert.equal(f.counters.credited, 10000);
});

test("return approval is saved before stock or refund work and resumes after failure", async t => {
  const f = fixture(t, { orderStatus: "return_requested", items: [{ _id: "64b000000000000000000003", product: "64b000000000000000000004", name: "Ball", slug: "ball", price: 10000, mrp: 10000, quantity: 1, lineTotal: 10000, status: "return_requested" }] });
  const admin = require("../services/adminOrderService");
  f.fail.restore = true;
  await assert.rejects(admin.decideReturn("NX-2026-000001", { decision: "approve", refundMethod: "wallet" }, { _id: user }));
  assert.equal(f.state().orderStatus, "returned");
  const reply = await admin.decideReturn("NX-2026-000001", { decision: "approve", refundMethod: "wallet" }, { _id: user });
  assert.equal(reply.order.paymentStatus, "refunded");
  assert.equal(f.counters.stockReturned, 1);
  assert.equal(f.counters.credited, 10000);
});

test("payment retry completes invoice work without decrementing stock twice", async t => {
  const f = fixture(t, { paymentMethod: "razorpay", paymentStatus: "pending", stockReserved: false, razorpay: { orderId: "order_test", paymentId: "" } }); f.fail.invoice = true;
  await assert.rejects(payments.markPaid("order_test", "pay_test", "test"), /invoice failure/);
  await payments.markPaid("order_test", "pay_test", "test");
  await payments.markPaid("order_test", "pay_test", "test");
  assert.equal(f.counters.stockTaken, 1);
  assert.equal(f.counters.invoices, 2);
  assert.equal(f.state().paymentFulfilled, true);
});

test("payment transport errors stay retryable and do not cancel a paid order", async t => {
  const f = fixture(t, { paymentMethod: "razorpay", paymentStatus: "pending", stockReserved: false }); f.fail.stock = new Error("database unavailable");
  await assert.rejects(payments.markPaid("order_test", "pay_test", "test"), /database unavailable/);
  assert.equal(f.state().orderStatus, "placed");
  assert.equal(f.state().paymentStockFailed, false);
  await payments.markPaid("order_test", "pay_test", "test");
  assert.equal(f.state().paymentFulfilled, true);
});

test("confirmation enqueue failure is retried rather than silently lost", async t => {
  const f = fixture(t, { paymentMethod: "razorpay", paymentStatus: "pending", stockReserved: false }); f.fail.event = true;
  await assert.rejects(payments.markPaid("order_test", "pay_test", "test"), /queued/);
  await payments.markPaid("order_test", "pay_test", "test");
  assert.equal(f.counters.stockTaken, 1);
  assert.equal(f.counters.events, 2);
  assert.equal(f.state().paymentFulfilled, true);
});

test("cancellation save failure does not restore stock or move money", async t => {
  const f = fixture(t); f.fail.save = true;
  const order = f.doc();
  await assert.rejects(orders.cancelItems(order, [...order.items]), /save failure/);
  assert.equal(f.counters.stockReturned, 0);
  assert.equal(f.counters.credited, 0);
  assert.equal(f.state().orderStatus, "placed");
});

test("saved cancellation resumes a lost stock response without duplicate restock or refund", async t => {
  const f = fixture(t); f.fail.restore = true;
  const order = f.doc();
  await assert.rejects(orders.cancelItems(order, [...order.items]), /stock return/);
  assert.equal(f.state().orderStatus, "cancelled");
  await settlements.resume(id);
  await settlements.resume(id);
  assert.equal(f.counters.stockReturned, 1);
  assert.equal(f.counters.credited, 10000);
  assert.equal(f.state().settlements[0].done, true);
});

test("stale concurrent cancellation cannot duplicate stock or money", async t => {
  const f = fixture(t), first = f.doc(), stale = f.doc();
  const results = await Promise.allSettled([orders.cancelItems(first, [...first.items]), orders.cancelItems(stale, [...stale.items])]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(f.counters.stockReturned, 1);
  assert.equal(f.counters.credited, 10000);
});

test("cancelling the whole order finishes a pending item cancellation and the remaining items", async t => {
  const f = fixture(t, { total: 20000, subtotal: 20000, mrpTotal: 20000, items: [
    { _id: "64b000000000000000000003", product: "64b000000000000000000004", name: "First", slug: "first", price: 10000, mrp: 10000, quantity: 1, lineTotal: 10000 },
    { _id: "64b000000000000000000005", product: "64b000000000000000000006", name: "Second", slug: "second", price: 10000, mrp: 10000, quantity: 1, lineTotal: 10000 }
  ] });
  f.fail.restore = true;
  const first = f.doc();
  await assert.rejects(orders.cancelItems(first, [first.items[0]]));
  const updated = await orders.cancelOrder(user, "NX-2026-000001");
  assert.equal(updated.orderStatus, "cancelled");
  assert.equal(f.counters.credited, 20000);
  assert.equal(f.counters.stockReturned, 2);
});
