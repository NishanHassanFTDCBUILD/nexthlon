// Read model for customer and admin screens. Stored lifecycle fields and money
// remain authoritative; this projection never mutates an order or moves funds.
const rules = require('./orderRules');
const {STORE} = require('../config/store');

function orderExperience(order, now = new Date()) {
  const items = order.items || [];
  const refunds = order.refunds || [];
  const sum = (status) =>
    refunds
      .filter((r) => r.status === status)
      .reduce((total, r) => total + (r.amount || 0), 0);
  const processing =
    (order.settlements || []).some((s) => !s.done) ||
    Boolean(order.paymentFulfillmentStarted && !order.paymentFulfilled);
  const paid =
    (order.walletUsed || 0) +
    (rules.PAID_STATUSES.includes(order.paymentStatus) ? order.total || 0 : 0);
  const reserved = order.refundedAmount || 0;
  const pendingRefund = sum('pending');
  const failedRefund = sum('failed');
  const refunded = sum('processed');
  const unpaidOnline =
    order.paymentMethod === 'razorpay' &&
    ['pending', 'failed'].includes(order.paymentStatus);
  const exchangeOpen = items.some((item) =>
    ['requested', 'approved'].includes(item.exchange?.status),
  );
  const paymentLabels = {
    pending:
      order.paymentMethod === 'cod' ? 'Pay on delivery' : 'Awaiting payment',
    paid: 'Paid',
    failed: 'Payment failed',
    refunded: pendingRefund ? 'Refund in progress' : 'Refunded',
    partially_refunded: pendingRefund
      ? 'Refund in progress'
      : 'Partly refunded',
  };
  let title = rules.STATUS_LABELS[order.orderStatus] || 'Order update';
  let message = 'We will keep your order details updated here.';
  let tone = 'info';
  if (processing) {
    title = 'Update processing';
    message =
      'A payment or order change is being completed. Refresh shortly before making another change.';
  } else if (order.orderStatus === 'cancelled') {
    message = pendingRefund
      ? 'Your order is cancelled. A refund is still processing.'
      : 'This order is closed. Any recorded refunds appear in the payment summary.';
    tone = 'muted';
  } else if (order.rto?.stage === 'initiated') {
    title = 'Parcel returning to us';
    message =
      'The courier could not deliver this parcel. The team will review it when it arrives back.';
    tone = 'warning';
  } else if (order.orderStatus === 'return_requested') {
    message =
      'Your return request is waiting for review. The decision will appear here.';
    tone = 'warning';
  } else if (order.orderStatus === 'returned') {
    message = pendingRefund
      ? 'Your return is approved. Your refund is processing.'
      : 'Your return is approved. Check the refund summary below.';
  } else if (unpaidOnline) {
    title = 'Payment required';
    message = 'Complete payment to reserve these items, or cancel the order.';
    tone = 'warning';
  } else if (order.orderStatus === 'delivered') {
    message = exchangeOpen
      ? 'A size exchange is in progress. You can follow its status with the item below.'
      : 'Your order has arrived. Keep your invoice and contact support if you need help.';
    tone = 'success';
  } else {
    message =
      {
        placed: 'Your order has been placed and is waiting for confirmation.',
        confirmed:
          'Your order is confirmed and is being prepared for dispatch.',
        shipped:
          'Your parcel is with the courier. Tracking updates appear below.',
        out_for_delivery: 'Your parcel is on its final delivery route.',
      }[order.orderStatus] || message;
  }
  const deadline = order.deliveredAt
    ? new Date(
        new Date(order.deliveredAt).getTime() + STORE.returnDays * 86400000,
      )
    : null;
  return {
    title,
    message,
    tone,
    processing,
    payment: {
      status: order.paymentStatus,
      label: paymentLabels[order.paymentStatus] || 'Payment update',
      received: paid,
    },
    fulfillment: {
      status: order.orderStatus,
      label: rules.STATUS_LABELS[order.orderStatus] || 'Order update',
    },
    refund: {
      processed: refunded,
      pending: pendingRefund,
      failed: failedRefund,
      reserved,
      available: Math.max(0, paid - reserved),
    },
    value: (order.total || 0) + (order.walletUsed || 0),
    returnDeadline:
      deadline && !Number.isNaN(deadline.getTime()) ? deadline : null,
    actions: {
      advanceFulfillment: !processing && !unpaidOnline,
      cancel: !processing && items.some(rules.canCancelItem),
      cancelItem: !processing && !unpaidOnline,
      return:
        !processing &&
        !exchangeOpen &&
        rules.canRequestReturn(order, STORE.returnDays, now),
    },
  };
}
module.exports = {orderExperience};
