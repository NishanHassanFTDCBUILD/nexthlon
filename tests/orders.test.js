// Order rules: status flow, cancelling, returns and how much money goes back.
require("./helpers");
const test = require("node:test");
const assert = require("node:assert/strict");
const rules = require("../utils/orderRules");
const { validatePlaceOrder, validateCancel, validateReturn } = require("../utils/validators");

const item = (id, status, lineTotal) => ({ _id: id, status, lineTotal, name: `Item ${id}`, quantity: 1 });

test("the order status follows its items", () => {
  assert.equal(rules.deriveOrderStatus([item(1, "placed"), item(2, "placed")]), "placed");
  assert.equal(rules.deriveOrderStatus([item(1, "shipped"), item(2, "cancelled")]), "shipped");
  assert.equal(rules.deriveOrderStatus([item(1, "cancelled"), item(2, "cancelled")]), "cancelled");
  assert.equal(rules.deriveOrderStatus([item(1, "delivered"), item(2, "return_requested")]), "return_requested");
  assert.equal(rules.deriveOrderStatus([item(1, "returned"), item(2, "cancelled")]), "returned");
  // The least advanced active item decides.
  assert.equal(rules.deriveOrderStatus([item(1, "delivered"), item(2, "confirmed")]), "confirmed");
});

test("statuses only move forward, and only placed or confirmed items can be cancelled", () => {
  assert.deepEqual(rules.nextStatuses("placed"), ["confirmed", "shipped", "out_for_delivery", "delivered"]);
  assert.deepEqual(rules.nextStatuses("shipped"), ["out_for_delivery", "delivered"]);
  assert.deepEqual(rules.nextStatuses("delivered"), []);
  assert.deepEqual(rules.nextStatuses("cancelled"), []);
  assert.equal(rules.canCancelItem({ status: "confirmed" }), true);
  assert.equal(rules.canCancelItem({ status: "shipped" }), false);
  assert.equal(rules.COD_LIMIT, 500000);
});

test("returns are allowed only after delivery and within the return window", () => {
  const delivered = { items: [item(1, "delivered")], deliveredAt: new Date("2026-11-01T10:00:00Z") };
  assert.equal(rules.canRequestReturn(delivered, 7, new Date("2026-11-08T09:00:00Z")), true);
  assert.equal(rules.canRequestReturn(delivered, 7, new Date("2026-11-08T11:00:00Z")), false);
  assert.equal(rules.canRequestReturn({ items: [item(1, "shipped")], deliveredAt: null }, 7), false);
});

test("refunds: each item's price less its share of the coupon, plus delivery when the last item goes", () => {
  const order = {
    items: [item("a", "placed", 60000), item("b", "placed", 40000)],
    subtotal: 100000, couponDiscount: 10000, deliveryFee: 4000, total: 94000, walletUsed: 0, refundedAmount: 0
  };
  // Item a: ₹600 less 60% of the ₹100 coupon = ₹540.
  assert.equal(rules.refundFor(order, ["a"]), 54000);
  // Both items: everything paid comes back, including delivery.
  assert.equal(rules.refundFor(order, ["a", "b"]), 94000);
  // Never more than what is left after earlier refunds.
  assert.equal(rules.refundFor({ ...order, refundedAmount: 90000 }, ["a", "b"]), 4000);
  // The last active item brings the delivery fee back too.
  order.items[0].status = "cancelled";
  assert.equal(rules.refundFor(order, ["b"]), 36000 + 4000);
});

test("checkout input: only the address and payment method are read", () => {
  const { errors, value } = validatePlaceOrder({ addressId: "64b0000000000000000000a1", paymentMethod: "cod", total: 1, items: [] });
  assert.deepEqual(errors, {});
  assert.deepEqual(value, { addressId: "64b0000000000000000000a1", paymentMethod: "cod" });
  assert.ok(validatePlaceOrder({ addressId: "nope" }).errors.addressId);
  assert.ok(validatePlaceOrder({ addressId: "64b0000000000000000000a1" }).errors.paymentMethod);
  assert.deepEqual(validateCancel({ reason: "<script>", refundMethod: "bank" }).value, { reason: "", refundMethod: "wallet" });
  assert.equal(validateCancel({ reason: rules.CANCEL_REASONS[0], refundMethod: "original" }).value.refundMethod, "original");
  assert.ok(validateReturn({ reason: "Just because" }).errors.reason);
  assert.equal(validateReturn({ reason: rules.RETURN_REASONS[1], note: "x".repeat(900) }).value.note.length, 500);
});
