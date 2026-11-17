const Order = require("../models/Order");
const logger = require("../utils/logger");

async function sweep() {
  const orders = await Order.find({ $or: [
    { paymentFulfillmentStarted: true, paymentFulfilled: false },
    { settlements: { $elemMatch: { done: false } } },
    { refundOperations: { $elemMatch: { done: false } } }
  ] }).sort({ updatedAt: 1 }).limit(50);
  for (const order of orders) {
    try {
      // Finish any saved refund first so it does not block another settlement.
      for (const op of order.refundOperations.filter(entry => !entry.done)) await require("./refundService").resume(order._id, op.key);
      await require("./settlementService").resume(order._id);
      if (order.paymentFulfillmentStarted && !order.paymentFulfilled) {
        await require("./paymentService").markPaid(order.razorpay.orderId, order.razorpay.paymentId, "recovery");
      }
    } catch (error) {
      logger.error("commerce.recovery_pending", { order: order.orderId, error });
    }
  }
  return orders.length;
}

module.exports = { sweep };
