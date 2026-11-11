// Gives money back for cancelled or returned items of an order.
//   "original": back to the card/UPI/bank through the Razorpay refunds API (paid online orders only)
//   "wallet":   straight into the customer's Nexthlon wallet, instantly
// Cash on Delivery money and wallet money always go back to the wallet.
const Order = require("../models/Order");
const events = require("../events");
const razorpayService = require("./razorpayService");
const walletService = require("./walletService");
const { PAID_STATUSES } = require("../utils/orderRules");

let walletCredit = (userId, amount, { reason, orderId }) => walletService.credit(userId, amount, { kind: "refund", reason, orderId });
// Tests can swap how a wallet is credited: (userId, amount, details) => Promise.
function setWalletCredit(fn) {
  walletCredit = fn;
}

function paymentStatusAfter(order) {
  if (order.refundedAmount <= 0) return order.paymentStatus;
  // Not paid yet (only the wallet part was): refunded once nothing is left to collect.
  if (!PAID_STATUSES.includes(order.paymentStatus)) {
    return order.total === 0 && order.refundedAmount >= (order.walletUsed || 0) ? "refunded" : order.paymentStatus;
  }
  const paid = order.total + (order.walletUsed || 0);
  return order.refundedAmount >= paid ? "refunded" : "partially_refunded";
}

// Back to the card/UPI/bank. If the gateway says no (or is down), the money goes to the
// wallet instead, so the customer is never left out.
async function refundOriginal(order, amount, reason) {
  const refund = { amount, method: "original", reason, status: "processed", at: new Date() };
  try {
    const result = await razorpayService.refundPayment(order.razorpay.paymentId, amount, { orderId: order.orderId });
    refund.razorpayRefundId = result.id || "";
    refund.status = result.status === "processed" ? "processed" : "pending";
  } catch (error) {
    razorpayService.logEvent("refund.failed", { order: order.orderId, amount, error: error && error.statusCode });
    refund.method = "wallet";
    await walletCredit(order.user, amount, { reason: reason || `Refund for ${order.orderId}`, orderId: order.orderId });
  }
  return refund;
}

// Gives back this amount. With "original", only what was paid ONLINE can go back to the card
// or UPI; the part paid from the wallet always goes back to the wallet.
async function issueRefund(order, amount, { method = "wallet", reason = "" } = {}) {
  if (!(amount > 0)) return [];
  const canReverse = order.paymentMethod === "razorpay" && order.razorpay && order.razorpay.paymentId && razorpayService.isEnabled();
  const onlineRefunded = (order.refunds || []).filter(entry => entry.method === "original").reduce((sum, entry) => sum + entry.amount, 0);
  const toOriginal = method === "original" && canReverse ? Math.max(0, Math.min(amount, order.total - onlineRefunded)) : 0;

  const refunds = [];
  if (toOriginal > 0) refunds.push(await refundOriginal(order, toOriginal, reason));
  if (amount - toOriginal > 0) {
    await walletCredit(order.user, amount - toOriginal, { reason: reason || `Refund for ${order.orderId}`, orderId: order.orderId });
    refunds.push({ amount: amount - toOriginal, method: "wallet", reason, status: "processed", at: new Date() });
  }

  const updated = await Order.findOneAndUpdate(
    { _id: order._id },
    { $push: { refunds: { $each: refunds } }, $inc: { refundedAmount: amount } },
    { new: true }
  );
  updated.paymentStatus = paymentStatusAfter(updated);
  await updated.save();
  order.refundedAmount = updated.refundedAmount;
  order.paymentStatus = updated.paymentStatus;
  order.refunds = updated.refunds;
  refunds.forEach(entry => razorpayService.logEvent("refund.issued", { order: order.orderId, amount: entry.amount, method: entry.method, status: entry.status }));
  // One email per refund, however many places the money went (the card and the wallet).
  const seq = updated.refunds.length;
  await events.emit("order.refunded", { orderId: order.orderId, seq, amount, parts: refunds.map(entry => ({ amount: entry.amount, method: entry.method, status: entry.status })), reason }, { key: `${order.orderId}:${seq}` });
  return refunds;
}

module.exports = { setWalletCredit, issueRefund, paymentStatusAfter };
