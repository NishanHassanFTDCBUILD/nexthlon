// Online payment with Razorpay (test mode).
//   1. createPaymentOrder: our order is saved as "pending" from the server's own prices, then a
//      Razorpay order is created for the same amount (paise) with our order id as the receipt.
//   2. The browser pays in Razorpay Checkout and sends back the ids and signature.
//   3. verifyPayment checks the signature, then marks the order paid, takes the stock and
//      clears the cart. The webhook does the same if the browser never comes back.
// Marking paid is IDEMPOTENT: an atomic "only if not paid yet" update and an atomic
// "only if stock not taken yet" claim mean a second call (or the webhook) changes nothing.
const Order = require("../models/Order");
const Cart = require("../models/Cart");
const Product = require("../models/Product");
const config = require("../config/env");
const checkoutService = require("./checkoutService");
const stockService = require("./stockService");
const orderService = require("./orderService");
const couponService = require("./couponService");
const walletService = require("./walletService");
const razorpay = require("./razorpayService");
const { HttpError } = require("../utils/http");
const { inTransaction } = require("../utils/transaction");

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
    throw new HttpError(502, "The payment gateway is not responding right now. Please try again, or choose Cash on Delivery.");
  }
  if (razorpayOrder.amount !== order.total) throw new HttpError(502, "The payment gateway returned a different amount. Please try again.");
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
async function createPaymentOrder(userId, { addressId, useWallet = false }) {
  if (!razorpay.isEnabled()) throw new HttpError(503, "Online payment is not available right now. Please choose Cash on Delivery.");
  const address = await checkoutService.findAddress(userId, addressId);
  const quote = await checkoutService.buildQuote(userId, { useWallet });
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
    const product = await Product.findOne({ _id: item.product, ...Product.LISTED }).select("stock").lean();
    if (!product || product.stock < item.quantity) throw new HttpError(409, `${item.name} is no longer available in that quantity. Please cancel this order and order again.`);
  }
  return { order, checkout: await attachRazorpayOrder(order) };
}

// Marks the order paid, takes the stock and clears those items from the cart. Safe to run twice.
async function markPaid(razorpayOrderId, razorpayPaymentId, source) {
  const paid = await Order.findOneAndUpdate(
    { "razorpay.orderId": razorpayOrderId, paymentStatus: { $in: ["pending", "failed"] } },
    {
      $set: { paymentStatus: "paid", "razorpay.paymentId": razorpayPaymentId },
      $push: { statusHistory: { status: "payment_received", by: "system", note: `Paid online (${source})` } }
    },
    { new: true }
  );
  if (!paid) return Order.findOne({ "razorpay.orderId": razorpayOrderId });
  razorpay.logEvent("payment.paid", { order: paid.orderId, payment: razorpayPaymentId, amount: paid.total, source });

  // Claim the stock step once; only the call that flips stockReserved takes the stock.
  const claimed = await Order.findOneAndUpdate({ _id: paid._id, stockReserved: false }, { $set: { stockReserved: true } }, { new: true });
  if (!claimed) return paid;
  const lines = claimed.items.filter(item => item.status !== "cancelled").map(item => ({ product: item.product, quantity: item.quantity, name: item.name }));
  try {
    await stockService.takeStock(lines);
  } catch (error) {
    // Paid, but an item sold out before the payment finished: cancel it and give the money back.
    await Order.updateOne({ _id: claimed._id }, { $set: { stockReserved: false } });
    const fresh = await Order.findById(claimed._id);
    await orderService.cancelItems(fresh, fresh.items.filter(item => item.status !== "cancelled"), { reason: "Sold out before the payment finished", by: "system", refundMethod: "original" });
    razorpay.logEvent("payment.stock_failed", { order: paid.orderId });
    return Order.findById(claimed._id);
  }
  const productIds = lines.map(line => line.product);
  const cartChange = { $pull: { items: { product: { $in: productIds } } } };
  if (claimed.couponCode) cartChange.$set = { couponCode: "" };
  await Cart.updateOne({ user: claimed.user }, cartChange);
  return Order.findById(claimed._id);
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

module.exports = { createPaymentOrder, retryPayment, markPaid, verifyPayment, markFailed, handleWebhook, isEnabled: razorpay.isEnabled };
