// The order lifecycle in one place. Pure functions, so every rule can be tested on its own.
const {percentOf} = require('./money');

const ORDER_STATUSES = [
  'placed',
  'confirmed',
  'shipped',
  'out_for_delivery',
  'delivered',
  'cancelled',
  'return_requested',
  'returned',
];
// The normal journey, in order. Statuses only ever move forward along it.
const FLOW = [
  'placed',
  'confirmed',
  'shipped',
  'out_for_delivery',
  'delivered',
];
// The shipping promise: an order placed and not yet shipped after this many hours is late.
const SHIP_WITHIN_HOURS = 24;

// Labels an admin can put on an order. Fixed, so a typo cannot make a second, unused label.
const ORDER_TAGS = ['gift', 'priority', 'fragile', 'check-fraud'];

const CANCELLABLE = ['placed', 'confirmed'];
const PAYMENT_STATUSES = [
  'pending',
  'paid',
  'failed',
  'refunded',
  'partially_refunded',
];
// Cash on Delivery for totals up to ₹5,000 (paise) until an admin changes it in Settings
// (services/settingsService.js "codLimit"; 0 turns cash on delivery off).
const COD_LIMIT = 500000;

const STATUS_LABELS = {
  placed: 'Order placed',
  confirmed: 'Confirmed',
  shipped: 'Shipped',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  return_requested: 'Return requested',
  returned: 'Returned',
};

const RETURN_REASONS = [
  'Wrong size or fit',
  'Damaged or defective',
  'Different from the description',
  'Received the wrong item',
  'No longer needed',
  'Something else',
];

const CANCEL_REASONS = [
  'Ordered by mistake',
  'Found a better price',
  'Delivery is too slow',
  'Want to change the address or items',
  'Something else',
];

function canCancelItem(item) {
  return CANCELLABLE.includes(item.status);
}

// The order's overall status, worked out from its items.
function deriveOrderStatus(items) {
  const active = items.filter((item) => item.status !== 'cancelled');
  if (!active.length) return 'cancelled';
  if (active.every((item) => item.status === 'returned')) return 'returned';
  if (active.some((item) => item.status === 'return_requested'))
    return 'return_requested';
  const steps = active
    .map((item) => FLOW.indexOf(item.status))
    .filter((index) => index >= 0);
  if (!steps.length) return 'returned';
  return FLOW[Math.min(...steps)];
}

// May the shopper ask to return this order? Only after delivery, within the return window.
function canRequestReturn(order, returnDays, now = new Date()) {
  if (deriveOrderStatus(order.items) !== 'delivered' || !order.deliveredAt)
    return false;
  const deadline =
    new Date(order.deliveredAt).getTime() + returnDays * 24 * 60 * 60 * 1000;
  return now.getTime() <= deadline;
}

// Forward-only moves for the admin: the next steps along the flow.
function nextStatuses(current) {
  const at = FLOW.indexOf(current);
  if (at < 0 || at === FLOW.length - 1) return [];
  return FLOW.slice(at + 1);
}

const PAID_STATUSES = ['paid', 'partially_refunded', 'refunded'];

// What these items are worth on this order: each item's line total, less its fair share of
// any coupon. When the last active items go, the delivery fee goes with them.
function itemsValue(order, itemIds) {
  const ids = itemIds.map(String);
  const chosen = order.items.filter((item) => ids.includes(String(item._id)));
  const subtotal = order.subtotal || 1;
  let amount = 0;
  for (const item of chosen) {
    // The coupon and the online-payment discount (E2) are shared by value, like the invoice does.
    const orderDiscount =
      (order.couponDiscount || 0) + (order.prepaidDiscount || 0);
    const couponShare = orderDiscount
      ? percentOf(orderDiscount, (item.lineTotal / subtotal) * 100)
      : 0;
    amount += item.lineTotal - couponShare;
  }
  const stillActive = order.items.filter(
    (item) =>
      !['cancelled', 'returned'].includes(item.status) &&
      !ids.includes(String(item._id)),
  );
  if (!stillActive.length) amount += order.deliveryFee || 0;
  return amount;
}

// The money to give back when these items of a PAID order are cancelled or returned.
// Never more than what is left of the amount actually paid.
function refundFor(order, itemIds) {
  const paid = (order.total || 0) + (order.walletUsed || 0);
  return Math.max(
    0,
    Math.min(itemsValue(order, itemIds), paid - (order.refundedAmount || 0)),
  );
}

// What cancelling these items settles, for any order:
//   dueReduction  how much less is left to collect (cash on delivery not paid yet)
//   refund        money back to the customer, for what was already paid (online or wallet)
// An unpaid order first lowers what is still to pay; only what the wallet already covered
// beyond that comes back.
function settlementFor(order, itemIds) {
  const value = itemsValue(order, itemIds);
  const paidAll = PAID_STATUSES.includes(order.paymentStatus);
  const paidSoFar = (order.walletUsed || 0) + (paidAll ? order.total || 0 : 0);
  const dueReduction = paidAll ? 0 : Math.min(value, order.total || 0);
  const refund = Math.max(
    0,
    Math.min(value - dueReduction, paidSoFar - (order.refundedAmount || 0)),
  );
  return {refund, dueReduction};
}

module.exports = {
  ORDER_TAGS,
  SHIP_WITHIN_HOURS,
  ORDER_STATUSES,
  FLOW,
  CANCELLABLE,
  PAYMENT_STATUSES,
  COD_LIMIT,
  PAID_STATUSES,
  STATUS_LABELS,
  RETURN_REASONS,
  CANCEL_REASONS,
  canCancelItem,
  deriveOrderStatus,
  canRequestReturn,
  nextStatuses,
  itemsValue,
  refundFor,
  settlementFor,
};
