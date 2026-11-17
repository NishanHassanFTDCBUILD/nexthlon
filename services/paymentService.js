// Online payment with Razorpay (test mode).
//   1. createPaymentOrder: our order is saved as "pending" from the server's own prices, then a
//      Razorpay order is created for the same amount (paise) with our order id as the receipt.
//   2. The browser pays in Razorpay Checkout and sends back the ids and signature.
//   3. verifyPayment checks the signature, then marks the order paid, takes the stock and
//      clears the cart. The webhook does the same if the browser never comes back.
// Marking paid is IDEMPOTENT: an atomic "only if not paid yet" update and an atomic
// "only if stock not taken yet" claim mean a second call (or the webhook) changes nothing.
const Order = require("../models/Order");
const events = require("../events");
const Cart = require("../models/Cart");
const buyNowService = require("./buyNowService");
const Product = require("../models/Product");
const config = require("../config/env");
const checkoutService = require("./checkoutService");
const stockService = require("./stockService");
const orderService = require("./orderService");
const couponService = require("./couponService");
const refundService = require("./refundService");
const gstService = require("./gstService");
const walletService = require("./walletService");
const razorpay = require("./razorpayService");
const { HttpError } = require("../utils/http");
const { inTransaction } = require("../utils/transaction");
const { LISTED_PRODUCT } = require("../utils/queryFilters");

function checkoutPayload(order, razorpayOrder) {
  // ONLY what Razorpay Checkout needs. Never the key secret.
  return { key_id: config.razorpay.keyId, razorpay_order_id: razorpayOrder.id, amount: razorpayOrder.amount, currency: razorpayOrder.currency || "INR" };
}

async function attachRazorpayOrder(order) {
  let razorpayOrder;
  try {
    razorpayOrder = await razorpay.createOrder({ amount: order.total, receipt: order.orderId, notes: { orderId: order.orderId } });
  } catch (error) {
    if (error instanceof HttpError) throw error;
    razorpay.logEvent("order.gateway_error", { order: order.orderId, status: error && error.statusCode });
    throw new HttpError(502, "The payment gateway is not responding right now. Please try again, or choose Cash on Delivery.", null, "gateway");
  }
  if (razorpayOrder.amount !== order.total) throw new HttpError(502, "The payment gateway returned a different amount. Please try again.", null, "gateway");
  order.razorpay.orderId = razorpayOrder.id;
  await order.save();
  razorpay.logEvent("order.created", { order: order.orderId, razorpayOrder: razorpayOrder.id, amount: order.total });
  return checkoutPayload(order, razorpayOrder);
}

// Undoes an order that never reached Razorpay: the coupon use and any wallet amount go back,
// and the order is removed so it does not clutter the list.
async function discardUnpaidOrder(order) {
  const removed = await Order.deleteOne({ _id: order._id, paymentStatus: "pending", "razorpay.orderId": "" });
  if (!removed.deletedCount) return;
  await couponService.release(order._id);
  if (order.walletUsed > 0) {
    await walletService.credit(order.user, order.walletUsed, { kind: "refund", reason: `Order ${order.orderId} was not placed`, orderId: order.orderId, key: `unplaced:${order._id}` });
  }
}

// Step 1. Builds the order from the cart with server prices and saves it unpaid. The coupon use
// and any wallet part are taken now (inside one transaction), and the rest is paid online.
// Stock is taken only when the payment succeeds; the cart stays until then.
async function createPaymentOrder(userId, { addressId, useWallet = false, source = "cart" }) {
  if (!razorpay.isEnabled()) throw new HttpError(503, "Online payment is not available right now. Please choose Cash on Delivery.", null, "gateway");
  const address = await checkoutService.findAddress(userId, addressId);
  const quote = await checkoutService.buildQuote(userId, { useWallet, source, payOnline: true });
  checkoutService.assertOrderable(quote);
  if (quote.totals.total <= 0) throw new HttpError(400, "Your wallet covers this order, so there is nothing to pay online. Choose \"Pay with wallet\".");
  const orderId = await checkoutService.nextOrderId();
  const order = await inTransaction((session, undo) => checkoutService.saveOrder({
    userId,
    orderId,
    quote,
    address,
    paymentMethod: "razorpay",
    paymentStatus: "pending",
    stockReserved: false,
    note: quote.totals.walletUsed ? "Part paid from the wallet, waiting for online payment" : "Waiting for online payment"
  }, session, undo));
  try {
    return { order, checkout: await attachRazorpayOrder(order) };
  } catch (error) {
    await discardUnpaidOrder(order);
    throw error;
  }
}

// Retry for an order whose payment failed or was closed. Same order, same snapshot prices,
// a fresh Razorpay order. Stops early if an item has sold out in the meantime.
async function retryPayment(userId, orderId) {
  const order = await orderService.getOwnedOrder(userId, orderId);
  if (order.paymentMethod !== "razorpay" || !["pending", "failed"].includes(order.paymentStatus) || order.orderStatus === "cancelled") {
    throw new HttpError(400, "This order does not need a payment.");
  }
  for (const item of order.items.filter(line => line.status !== "cancelled")) {
    const product = await Product.findOne({ _id: item.product, ...LISTED_PRODUCT }).select("stock variants").lean();
    // An item bought in a size is checked against that size's own stock.
    const option = item.variant && product ? (product.variants || []).find(v => String(v._id) === String(item.variant)) : null;
    const left = !product ? 0 : item.variant ? (option ? option.stock : 0) : product.stock;
    if (left < item.quantity) throw new HttpError(409, `${item.name} is no longer available in that quantity. Please cancel this order and order again.`);
  }
  return { order, checkout: await attachRazorpayOrder(order) };
}

// Marks the order paid, takes the stock and clears those items from the cart. Safe to run twice.
async function markPaid(razorpayOrderId, razorpayPaymentId, source) {
  const { runExclusive } = require("../utils/exclusive");
  return runExclusive("payment:" + razorpayOrderId, async () => {
    let paid = await Order.findOneAndUpdate(
      { "razorpay.orderId": razorpayOrderId, paymentStatus: { $in: ["pending", "failed"] } },
      { $set: { paymentStatus: "paid", "razorpay.paymentId": razorpayPaymentId, paymentFulfillmentStarted: true },
        $inc: { __v: 1 }, $push: { statusHistory: { status: "payment_received", by: "system", note: "Paid online (" + source + ")" } } },
      { new: true }
    );
    if (!paid) paid = await Order.findOne({ "razorpay.orderId": razorpayOrderId });
    if (!paid || paid.paymentFulfilled) return paid;
    if (paid.razorpay.paymentId !== razorpayPaymentId) throw new HttpError(409, "This order is associated with a different payment.");
    const reservation = "payment:" + paid._id;
    const lines = paid.items.filter(item => item.status !== "cancelled").map(item => ({ product: item.product, variant: item.variant || null, quantity: item.quantity, name: item.name }));
    if (paid.orderStatus !== "cancelled" && !paid.stockReserved && !paid.paymentStockFailed) {
      try {
        await stockService.takeStockOnce(lines, reservation);
        await Order.updateOne({ _id: paid._id }, { $set: { stockReserved: true }, $inc: { __v: 1 } });
      } catch (error) {
        // A network/database error is retryable, not evidence that goods sold out.
        if (error.reason !== "items_unavailable") throw error;
        await Order.updateOne({ _id: paid._id }, { $set: { paymentStockFailed: true }, $inc: { __v: 1 } });
      }
      paid = await Order.findById(paid._id);
    }
    if (paid.paymentStockFailed && paid.orderStatus !== "cancelled") {
      // Only return lines actually reserved; a crash half-way through taking stock
      // cannot inflate stock or cause a second decrement on the next callback.
      await stockService.returnStockOnce(lines, reservation + ":rollback", reservation);
      await Order.updateOne({ _id: paid._id }, { $set: { stockReserved: false }, $inc: { __v: 1 } });
      paid = await Order.findById(paid._id);
      paid = await orderService.cancelItems(paid, paid.items.filter(item => item.status !== "cancelled"), {
        reason: "Sold out before the payment finished", by: "system", refundMethod: "original"
      });
    }
    if (paid.orderStatus === "cancelled") {
      paid = await require("./settlementService").resume(paid._id);
      const remaining = paid.total + (paid.walletUsed || 0) - paid.refundedAmount;
      if (remaining > 0) await refundService.issueRefund(paid, Math.min(paid.total, remaining), {
        method: "original", reason: "Paid after the order was cancelled", key: "late-payment:" + razorpayPaymentId
      });
    } else {
      if (paid.source === "buynow") await buyNowService.clear(paid.user);
      else {
        const bought = lines.map(line => ({ product: line.product, variant: line.variant || null }));
        const change = { $pull: { items: { $or: bought } } };
        if (paid.couponCode) change.$set = { couponCode: "" };
        await Cart.updateOne({ user: paid.user }, change);
      }
      await gstService.issueInvoice(paid._id);
      if (await events.emit("order.placed", { orderId: paid.orderId }, { key: paid.orderId }) === false) {
        throw new Error("Payment confirmation could not be queued; it will be retried.");
      }
    }
    await Order.updateOne({ _id: paid._id }, { $set: { paymentFulfilled: true } });
    return Order.findById(paid._id);
  });
}

// Where a payment stands, for the checkout page to poll when the verify call could not get through.
// Only the owner can ask.
async function getStatus(userId, razorpayOrderId) {
  const order = await Order.findOne({ "razorpay.orderId": razorpayOrderId, user: userId })
    .select("orderId paymentStatus orderStatus total walletUsed")
    .lean();
  if (!order) throw new HttpError(404, "Order not found.");
  return order;
}

// Step 3. The browser's proof of payment, checked against the signature before anything changes.
async function verifyPayment(userId, { razorpayOrderId, razorpayPaymentId, signature }) {
  const order = await Order.findOne({ "razorpay.orderId": razorpayOrderId, user: userId });
  if (!order) throw new HttpError(404, "Order not found.");
  if (!razorpay.verifyPaymentSignature(razorpayOrderId, razorpayPaymentId, signature)) {
    razorpay.logEvent("payment.bad_signature", { order: order.orderId });
    throw new HttpError(400, "We could not confirm this payment. If money was taken, it will be refunded automatically.");
  }
  return markPaid(razorpayOrderId, razorpayPaymentId, "checkout");
}

// The shopper closed Checkout or the payment failed: the order shows "payment failed" with a
// Retry button, and the cart is kept.
async function markFailed(razorpayOrderId, { userId = null, reason = "" } = {}) {
  const filter = { "razorpay.orderId": razorpayOrderId, paymentStatus: "pending" };
  if (userId) filter.user = userId;
  const order = await Order.findOneAndUpdate(
    filter,
    { $set: { paymentStatus: "failed" }, $push: { statusHistory: { status: "payment_failed", by: "system", note: reason.slice(0, 120) } } },
    { new: true }
  );
  if (order) razorpay.logEvent("payment.failed", { order: order.orderId, reason: reason ? "given" : "" });
  return order || (userId ? Order.findOne({ "razorpay.orderId": razorpayOrderId, user: userId }) : null);
}

// Step 5. Razorpay calls this when something happens, even if the shopper closed the tab.
async function handleWebhook(rawBody, signature) {
  if (!razorpay.verifyWebhookSignature(rawBody, signature)) throw new HttpError(400, "Invalid signature.");
  let event;
  try {
    event = JSON.parse(rawBody.toString("utf8"));
  } catch {
    throw new HttpError(400, "Invalid body.");
  }
  const name = event && event.event;
  const payment = event && event.payload && event.payload.payment && event.payload.payment.entity;
  const refund = event && event.payload && event.payload.refund && event.payload.refund.entity;

  if (name === "payment.captured" && payment && payment.order_id) {
    const order = await Order.findOne({ "razorpay.orderId": payment.order_id }).select("total orderId").lean();
    if (!order) return { handled: false };
    if (payment.amount !== order.total) {
      razorpay.logEvent("webhook.amount_mismatch", { order: order.orderId, expected: order.total, got: payment.amount });
      return { handled: false };
    }
    await markPaid(payment.order_id, payment.id, "webhook");
    return { handled: true };
  }
  if (name === "payment.failed" && payment && payment.order_id) {
    await markFailed(payment.order_id, { reason: payment.error_description || "" });
    return { handled: true };
  }
  if (name === "refund.processed" && refund && refund.id) {
    await Order.updateOne({ "refunds.razorpayRefundId": refund.id }, { $set: { "refunds.$.status": "processed" } });
    razorpay.logEvent("refund.processed", { refund: refund.id, amount: refund.amount });
    return { handled: true };
  }
  return { handled: false };
}

module.exports = { createPaymentOrder, retryPayment, markPaid, getStatus, verifyPayment, markFailed, handleWebhook, isEnabled: razorpay.isEnabled };
