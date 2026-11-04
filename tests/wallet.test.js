// Phase 6 rules that need no database: coupon maths, order totals with the wallet, what a
// cancellation settles, referral codes and the logger.
require("./helpers");
const test = require("node:test");
const assert = require("node:assert/strict");
const pricing = require("../utils/pricing");
const rules = require("../utils/orderRules");
const { paymentStatusAfter } = require("../services/refundService");
const { makeCode, CODE } = require("../services/referralService");
const { describe } = require("../services/couponService");
const logger = require("../utils/logger");
const { validateReferralSetting, readFlag } = require("../utils/validators");

const percent = { code: "SAVE10", type: "percent", value: 10, maxDiscount: 10000, minOrder: 100000, isActive: true, usageLimit: 0, usedCount: 0, perUserLimit: 1 };
const flat = { code: "FLAT200", type: "flat", value: 20000, maxDiscount: 0, minOrder: 0, isActive: true, usageLimit: 0, usedCount: 0, perUserLimit: 0 };

test("coupon discount: percent with a cap, flat, and never more than the subtotal", () => {
  assert.equal(pricing.couponDiscountFor(percent, 50000), 5000);
  assert.equal(pricing.couponDiscountFor(percent, 150000), 10000); // 15,000 capped at ₹100
  assert.equal(pricing.couponDiscountFor({ ...percent, maxDiscount: 0 }, 150000), 15000);
  assert.equal(pricing.couponDiscountFor({ ...percent, value: 15 }, 33333), 4900); // ₹49.99 rounds down to ₹49
  assert.equal(pricing.couponDiscountFor(flat, 150000), 20000);
  assert.equal(pricing.couponDiscountFor(flat, 15000), 15000);
  assert.equal(pricing.couponDiscountFor(null, 150000), 0);
  assert.equal(pricing.couponDiscountFor(flat, 0), 0);
});

test("coupon checks: active, dates, total and per-customer limits, minimum order", () => {
  const now = new Date("2026-11-04T10:00:00Z");
  assert.equal(pricing.couponProblem(percent, { subtotal: 150000, now }), null);
  assert.match(pricing.couponProblem({ ...percent, isActive: false }, { subtotal: 150000, now }), /not valid/);
  assert.match(pricing.couponProblem({ ...percent, startsAt: new Date("2026-11-05") }, { subtotal: 150000, now }), /not active yet/);
  assert.match(pricing.couponProblem({ ...percent, endsAt: new Date("2026-11-03") }, { subtotal: 150000, now }), /expired/);
  assert.match(pricing.couponProblem({ ...percent, usageLimit: 5, usedCount: 5 }, { subtotal: 150000, now }), /fully used/);
  assert.match(pricing.couponProblem(percent, { subtotal: 150000, usedByUser: 1, now }), /already used/);
  assert.equal(pricing.couponProblem(flat, { subtotal: 150000, usedByUser: 9, now }), null); // 0 = no per-customer limit
  assert.equal(pricing.couponProblem(percent, { subtotal: 70000, now }), "Add items worth ₹300 more to use this coupon.");
  assert.equal(describe(percent), "10% off up to ₹100 on orders over ₹1,000");
  assert.equal(describe(flat), "₹200 off");
});

test("order totals: coupon, delivery from the item subtotal, then the wallet", () => {
  const base = { itemCount: 1, mrpTotal: 60000, subtotal: 50000 };
  const plain = pricing.orderTotals(base);
  assert.deepEqual([plain.discount, plain.deliveryFee, plain.payable, plain.walletUsed, plain.total], [10000, 0, 50000, 0, 50000]);

  // A coupon that takes the basket below ₹499 does not add a delivery fee: delivery follows the items.
  const withCoupon = pricing.orderTotals({ ...base, coupon: { ...flat, value: 5000 } });
  assert.equal(withCoupon.couponDiscount, 5000);
  assert.equal(withCoupon.couponCode, "FLAT200");
  assert.equal(withCoupon.deliveryFee, 0);
  assert.equal(withCoupon.total, 45000);

  const small = pricing.orderTotals({ itemCount: 1, mrpTotal: 30000, subtotal: 30000 });
  assert.equal(small.deliveryFee, 4000);
  assert.equal(small.total, 34000);

  // The wallet is used only when asked, and never for more than is payable.
  assert.equal(pricing.orderTotals({ ...base, walletBalance: 20000 }).walletUsed, 0);
  const part = pricing.orderTotals({ ...base, walletBalance: 20000, useWallet: true });
  assert.deepEqual([part.walletUsed, part.total], [20000, 30000]);
  const full = pricing.orderTotals({ ...base, walletBalance: 900000, useWallet: true });
  assert.deepEqual([full.walletUsed, full.total], [50000, 0]);
  assert.equal(pricing.orderTotals({ ...base, coupon: null }).couponCode, "");
});

const line = (id, lineTotal, status = "placed") => ({ _id: id, lineTotal, status });

test("cancelling an unpaid order lowers what is left to collect before refunding the wallet part", () => {
  // ₹1,000 of items, ₹300 from the wallet, ₹700 cash on delivery.
  const order = { items: [line("a", 50000), line("b", 50000)], subtotal: 100000, couponDiscount: 0, deliveryFee: 0, total: 70000, walletUsed: 30000, refundedAmount: 0, paymentStatus: "pending" };
  assert.deepEqual(rules.settlementFor(order, ["a"]), { refund: 0, dueReduction: 50000 });
  assert.deepEqual(rules.settlementFor(order, ["a", "b"]), { refund: 30000, dueReduction: 70000 });
  // After item a went, only ₹200 is left to collect; item b gives back ₹300 from the wallet.
  order.items[0].status = "cancelled";
  assert.deepEqual(rules.settlementFor({ ...order, total: 20000 }, ["b"]), { refund: 30000, dueReduction: 20000 });
  // A paid order refunds what was paid, never more.
  const paid = { ...order, items: [line("a", 50000), line("b", 50000)], paymentStatus: "paid" };
  assert.deepEqual(rules.settlementFor(paid, ["a"]), { refund: 50000, dueReduction: 0 });
  assert.deepEqual(rules.settlementFor({ ...paid, refundedAmount: 90000 }, ["a", "b"]), { refund: 10000, dueReduction: 0 });
});

test("payment status after a refund, for paid and not-yet-paid orders", () => {
  assert.equal(paymentStatusAfter({ paymentStatus: "paid", total: 70000, walletUsed: 30000, refundedAmount: 100000 }), "refunded");
  assert.equal(paymentStatusAfter({ paymentStatus: "paid", total: 70000, walletUsed: 30000, refundedAmount: 40000 }), "partially_refunded");
  // Cash on delivery: the wallet part came back and nothing is left to collect.
  assert.equal(paymentStatusAfter({ paymentStatus: "pending", total: 0, walletUsed: 30000, refundedAmount: 30000 }), "refunded");
  assert.equal(paymentStatusAfter({ paymentStatus: "pending", total: 20000, walletUsed: 30000, refundedAmount: 0 }), "pending");
});

test("referral codes: 8 characters from the name and an unambiguous random part", () => {
  const code = makeCode("Asha Nair", Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]));
  assert.equal(code, "ASHAABCD");
  assert.match(makeCode("Ō"), /^NX[A-Z2-9]{6}$/);
  for (let i = 0; i < 50; i += 1) {
    const random = makeCode("Li");
    assert.equal(random.length, 8);
    assert.ok(CODE.test(random));
    assert.doesNotMatch(random.slice(2), /[01OI]/);
  }
});

test("admin referral reward input, and wallet flags", () => {
  assert.equal(validateReferralSetting({ referralReward: "150" }).value.referralReward, 15000);
  assert.equal(validateReferralSetting({ referralReward: 0 }).value.referralReward, 0);
  assert.ok(validateReferralSetting({ referralReward: "1001" }).errors.referralReward);
  assert.ok(validateReferralSetting({ referralReward: "-5" }).errors.referralReward);
  assert.ok(validateReferralSetting({ referralReward: "12.5" }).errors.referralReward);
  assert.equal(readFlag(true), true);
  assert.equal(readFlag("true"), true);
  assert.equal(readFlag("yes"), false);
  assert.equal(readFlag(undefined), false);
});

test("the logger never writes secrets or card details", () => {
  const line = logger.clean({ order: "NX-2026-000001", amount: 500, keySecret: "x", razorpay_signature: "y", cardNumber: "4111", password: "p", note: "" });
  assert.equal(line, "order=NX-2026-000001 amount=500");
});
