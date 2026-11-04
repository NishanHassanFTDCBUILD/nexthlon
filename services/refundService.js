// Gives money back for cancelled or returned items of a PAID order.
//   "original": back to the card/UPI/bank through the Razorpay refunds API (online payments only)
//   "wallet":   straight into the customer's Nexthlon wallet (added with the wallet feature)
// Cash on Delivery money is always refunded to the wallet, since there is nothing to reverse.
const Order = require("../models/Order");
const razorpayService = require("./razorpayService");

let walletCredit = null;
// The wallet feature registers how to credit a wallet: (userId, amount, details) => Promise.
function setWalletCredit(fn) {
  walletCredit = fn;
}

function paymentStatusAfter(order) {
  const paid = order.total + (order.walletUsed || 0);
  if (order.refundedAmount <= 0) return order.paymentStatus;
  return order.refundedAmount >= paid ? "refunded" : "partially_refunded";
}

async function issueRefund(order, amount, { method = "wallet", reason = "" } = {}) {
  if (!(amount > 0)) return null;
  const canReverse = order.paymentMethod === "razorpay" && order.razorpay && order.razorpay.paymentId && razorpayService.isEnabled();
  let useMethod = method === "original" && canReverse ? "original" : "wallet";
  if (useMethod === "wallet" && !walletCredit) useMethod = canReverse ? "original" : null;
  if (!useMethod) return null;

  const refund = { amount, method: useMethod, reason, status: "processed", at: new Date() };
  if (useMethod === "original") {
    try {
      const result = await razorpayService.refundPayment(order.razorpay.paymentId, amount, { orderId: order.orderId });
      refund.razorpayRefundId = result.id || "";
      refund.status = result.status === "processed" ? "processed" : "pending";
    } catch (error) {
      // The gateway said no (or is down): fall back to the wallet so the customer is never left out.
      razorpayService.logEvent("refund.failed", { order: order.orderId, amount, error: error && error.statusCode });
      if (!walletCredit) throw error;
      refund.method = "wallet";
    }
  }
  if (refund.method === "wallet") {
    await walletCredit(order.user, amount, { reason: reason || `Refund for ${order.orderId}`, orderId: order.orderId });
  }
  const updated = await Order.findOneAndUpdate(
    { _id: order._id },
    { $push: { refunds: refund }, $inc: { refundedAmount: amount } },
    { new: true }
  );
  updated.paymentStatus = paymentStatusAfter(updated);
  await updated.save();
  order.refundedAmount = updated.refundedAmount;
  order.paymentStatus = updated.paymentStatus;
  order.refunds = updated.refunds;
  razorpayService.logEvent("refund.issued", { order: order.orderId, amount, method: refund.method, status: refund.status });
  return refund;
}

module.exports = { setWalletCredit, issueRefund, paymentStatusAfter };
