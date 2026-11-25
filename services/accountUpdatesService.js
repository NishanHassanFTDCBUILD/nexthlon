const Order = require('../models/Order');
const {orderExperience} = require('../utils/orderExperience');

// A bounded, owner-scoped inbox of orders that still need attention.
async function forUser(userId) {
  const orders = await Order.find({
    user: userId,
    $or: [
      {
        orderStatus: {
          $in: [
            'placed',
            'confirmed',
            'shipped',
            'out_for_delivery',
            'return_requested',
          ],
        },
      },
      {refunds: {$elemMatch: {status: 'pending'}}},
    ],
  })
    .sort({updatedAt: -1, _id: -1})
    .limit(4)
    .select(
      'orderId orderStatus paymentMethod paymentStatus total walletUsed refundedAmount deliveredAt items.status items.exchange refunds shipments settlements paymentFulfillmentStarted paymentFulfilled rto.stage updatedAt',
    )
    .lean();
  return orders.map((order) => {
    const state = orderExperience(order);
    return {
      orderId: order.orderId,
      title: state.title,
      message: state.message,
      tone: state.tone,
      href: `/orders/${order.orderId}`,
      action:
        state.title === 'Payment required' ? 'Complete payment' : 'View update',
    };
  });
}
module.exports = {forUser};
