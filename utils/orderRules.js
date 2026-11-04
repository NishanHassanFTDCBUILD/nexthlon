// The order lifecycle in one place. Pure functions, so every rule can be tested on its own.
const { percentOf } = require("./money");

const ORDER_STATUSES = ["placed", "confirmed", "shipped", "out_for_delivery", "delivered", "cancelled", "return_requested", "returned"];
// The normal journey, in order. Statuses only ever move forward along it.
const FLOW = ["placed", "confirmed", "shipped", "out_for_delivery", "delivered"];
const CANCELLABLE = ["placed", "confirmed"];
const PAYMENT_STATUSES = ["pending", "paid", "failed", "refunded", "partially_refunded"];
const COD_LIMIT = 500000; // Cash on Delivery for totals up to ₹5,000 (paise)

const STATUS_LABELS = {
  placed: "Order placed",
  confirmed: "Confirmed",
  shipped: "Shipped",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
  return_requested: "Return requested",
  returned: "Returned"
};

const RETURN_REASONS = [
  "Wrong size or fit",
  "Damaged or defective",
  "Different from the description",
  "Received the wrong item",
  "No longer needed",
  "Something else"
];

const CANCEL_REASONS = [
  "Ordered by mistake",
  "Found a better price",
  "Delivery is too slow",
  "Want to change the address or items",
  "Something else"
];

function canCancelItem(item) {
  return CANCELLABLE.includes(item.status);
}

// The order's overall status, worked out from its items.
function deriveOrderStatus(items) {
  const active = items.filter(item => item.status !== "cancelled");
  if (!active.length) return "cancelled";
  if (active.every(item => item.status === "returned")) return "returned";
  if (active.some(item => item.status === "return_requested")) return "return_requested";
  const steps = active.map(item => FLOW.indexOf(item.status)).filter(index => index >= 0);
  if (!steps.length) return "returned";
  return FLOW[Math.min(...steps)];
}

// May the shopper ask to return this order? Only after delivery, within the return window.
function canRequestReturn(order, returnDays, now = new Date()) {
  if (deriveOrderStatus(order.items) !== "delivered" || !order.deliveredAt) return false;
  const deadline = new Date(order.deliveredAt).getTime() + returnDays * 24 * 60 * 60 * 1000;
  return now.getTime() <= deadline;
}

// Forward-only moves for the admin: the next steps along the flow.
function nextStatuses(current) {
  const at = FLOW.indexOf(current);
  if (at < 0 || at === FLOW.length - 1) return [];
  return FLOW.slice(at + 1);
}

// The money to give back when these items are cancelled or returned. Each item gives back
// what was paid for it: its line total, less its fair share of any coupon. When the last
// active items go, the delivery fee goes back too.
function refundFor(order, itemIds) {
  const ids = itemIds.map(String);
  const chosen = order.items.filter(item => ids.includes(String(item._id)));
  const subtotal = order.subtotal || 1;
  let amount = 0;
  for (const item of chosen) {
    const couponShare = order.couponDiscount ? percentOf(order.couponDiscount, (item.lineTotal / subtotal) * 100) : 0;
    amount += item.lineTotal - couponShare;
  }
  const stillActive = order.items.filter(item => !["cancelled", "returned"].includes(item.status) && !ids.includes(String(item._id)));
  if (!stillActive.length) amount += order.deliveryFee || 0;
  // Never more than what is left of the amount actually paid.
  const paid = (order.total || 0) + (order.walletUsed || 0);
  return Math.max(0, Math.min(amount, paid - (order.refundedAmount || 0)));
}

module.exports = {
  ORDER_STATUSES,
  FLOW,
  CANCELLABLE,
  PAYMENT_STATUSES,
  COD_LIMIT,
  STATUS_LABELS,
  RETURN_REASONS,
  CANCEL_REASONS,
  canCancelItem,
  deriveOrderStatus,
  canRequestReturn,
  nextStatuses,
  refundFor
};
