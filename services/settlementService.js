// Stock, refund and notification work is written on the order with its status
// change. Every side effect has a stable key, so retries can finish safely.
const Order = require("../models/Order");
const stock = require("./stockService");
const refunds = require("./refundService");
const coupons = require("./couponService");
const gst = require("./gstService");
const events = require("../events");
const { runExclusive } = require("../utils/exclusive");
let refundHandler = (...args) => refunds.issueRefund(...args);
function setRefundHandler(handler) { refundHandler = handler; }

async function resume(orderId) {
  return runExclusive(`settlement:${orderId}`, async () => {
    let order = await Order.findById(orderId);
    for (const op of order.settlements.filter(entry => !entry.done)) {
      const items = order.items.filter(item => op.itemIds.includes(String(item._id)));
      if (op.restoreStock) await stock.returnStockOnce(items.map(item => ({ product: item.product, variant: item.variant, quantity: item.quantity })), op.key);
      if (op.refund > 0 && refundHandler) await refundHandler(order, op.refund, { method: op.method, reason: op.reason, key: op.key });
      if (order.orderStatus === "cancelled" && order.couponCode) await coupons.release(order._id);
      await gst.syncCreditNotes(order._id, op.reason);
      if (await events.emit(op.event, op.payload, { key: op.key }) === false) throw new Error("Order notification could not be queued; it will be retried.");
      await Order.updateOne({ _id: orderId, "settlements.key": op.key }, { $set: { "settlements.$.done": true } });
    }
    order = await Order.findById(orderId);
    return order;
  });
}

function assertSettled(order) {
  if ((order.settlements || []).some(entry => !entry.done)) {
    const { HttpError } = require("../utils/http");
    throw new HttpError(409, "The previous order change is still processing. Please try again shortly.");
  }
  if (order.paymentFulfillmentStarted && !order.paymentFulfilled) {
    const { HttpError } = require("../utils/http");
    throw new HttpError(409, "Your payment is being completed. Please try again shortly.");
  }
}

module.exports = { resume, assertSettled, setRefundHandler };
