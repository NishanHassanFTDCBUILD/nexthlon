// Persist refund intent before moving money. Wallet receipts make retries safe;
// uncertain gateway responses are reconciled instead of falling back to another payment.
const Order = require('../models/Order');
const events = require('../events');
const razorpayService = require('./razorpayService');
const walletService = require('./walletService');
const {PAID_STATUSES} = require('../utils/orderRules');
const {HttpError} = require('../utils/http');
const {runExclusive} = require('../utils/exclusive');
let walletCredit = (userId, amount, {reason, orderId, key}) =>
  walletService.credit(userId, amount, {kind: 'refund', reason, orderId, key});
function setWalletCredit(fn) {
  walletCredit = fn;
}
function paymentStatusAfter(order) {
  if (order.refundedAmount <= 0) return order.paymentStatus;
  if (!PAID_STATUSES.includes(order.paymentStatus))
    return order.total === 0 && order.refundedAmount >= (order.walletUsed || 0)
      ? 'refunded'
      : order.paymentStatus;
  return order.refundedAmount >= order.total + (order.walletUsed || 0)
    ? 'refunded'
    : 'partially_refunded';
}
const pendingError = () =>
  new HttpError(
    503,
    'Your refund is saved and is awaiting confirmation. Please check the order again shortly.',
    null,
    'refund_pending',
  );
async function execute(orderId, key) {
  let order = await Order.findById(orderId);
  let op = order.refundOperations.find((entry) => entry.key === key);
  const externalKey = require('crypto')
    .createHash('sha256')
    .update(`${orderId}:${key}`)
    .digest('hex');
  if (op.done) return op.parts;
  if (!op.recorded) {
    const original = op.parts.find((part) => part.method === 'original');
    if (original && !original.razorpayRefundId) {
      const claimed = await Order.findOneAndUpdate(
        {
          _id: orderId,
          refundOperations: {$elemMatch: {key, gatewayStarted: false}},
        },
        {
          $set: {
            'refundOperations.$.gatewayStarted': true,
            'refundOperations.$.gatewayStartedAt': new Date(),
          },
        },
        {new: true},
      );
      let result;
      if (claimed) {
        try {
          result = await razorpayService.refundPayment(
            order.razorpay.paymentId,
            original.amount,
            {orderId: order.orderId, refundKey: externalKey},
          );
        } catch (error) {
          razorpayService.logEvent('refund.awaiting_confirmation', {
            order: order.orderId,
            error: error && error.statusCode,
          });
          // Definite rejections did not move money. Timeouts and transport errors may have.
          if (
            error.statusCode >= 400 &&
            error.statusCode < 500 &&
            ![408, 429].includes(error.statusCode)
          ) {
            await Order.updateOne(
              {_id: orderId, 'refundOperations.key': key},
              {$set: {'refundOperations.$.gatewayStarted': false}},
            );
          }
          throw pendingError();
        }
      } else {
        result = await razorpayService.findRefund(
          order.razorpay.paymentId,
          externalKey,
        );
        if (!result) throw pendingError();
      }
      if (
        !result.id ||
        (result.amount !== undefined && result.amount !== original.amount) ||
        result.status === 'failed'
      )
        throw pendingError();
      original.razorpayRefundId = result.id;
      original.status = result.status === 'processed' ? 'processed' : 'pending';
      await Order.updateOne(
        {_id: orderId, 'refundOperations.key': key},
        {$set: {'refundOperations.$.parts': op.parts}},
      );
    }
    for (const part of op.parts.filter((entry) => entry.method === 'wallet')) {
      await walletCredit(order.user, part.amount, {
        reason: (op.reason || 'Refund for ' + order.orderId).slice(0, 160),
        orderId: order.orderId,
        key: 'refund:' + externalKey + ':wallet',
      });
    }
    await Order.updateOne(
      {_id: orderId, refundOperations: {$elemMatch: {key, recorded: false}}},
      {
        $push: {refunds: {$each: op.parts}},
        $inc: {refundedAmount: op.amount, __v: 1},
        $set: {'refundOperations.$.recorded': true},
      },
    );
  }
  order = await Order.findById(orderId);
  op = order.refundOperations.find((entry) => entry.key === key);
  const status = await Order.updateOne(
    {_id: orderId, __v: order.__v},
    {$set: {paymentStatus: paymentStatusAfter(order)}, $inc: {__v: 1}},
  );
  if (!status.modifiedCount) throw pendingError();
  const queued = await events.emit(
    'order.refunded',
    {
      orderId: order.orderId,
      seq: order.refunds.length,
      amount: op.amount,
      parts: op.parts.map(({amount, method, status}) => ({
        amount,
        method,
        status,
      })),
      reason: op.reason,
    },
    {key: order.orderId + ':' + key},
  );
  if (queued === false) throw pendingError();
  await Order.updateOne(
    {_id: orderId, 'refundOperations.key': key},
    {$set: {'refundOperations.$.done': true}},
  );
  return op.parts;
}
async function issueRefund(
  order,
  amount,
  {method = 'wallet', reason = '', key} = {},
) {
  if (!(amount > 0)) return [];
  if (!Number.isSafeInteger(amount))
    throw new HttpError(400, 'Refund amounts must be whole paise.');
  return runExclusive('refund:' + order._id, async () => {
    let fresh = await Order.findById(order._id);
    if (!fresh) throw new HttpError(404, 'Order not found.');
    const pending = fresh.refundOperations.find((entry) => !entry.done);
    const operationKey =
      key || (pending ? pending.key : 'manual:' + fresh.refundedAmount);
    const op = fresh.refundOperations.find(
      (entry) => entry.key === operationKey,
    );
    if (!op) {
      if (
        fresh.settlements.some(
          (entry) => !entry.done && entry.key !== operationKey,
        )
      )
        throw new HttpError(
          409,
          'The previous order change must finish before another refund is requested.',
        );
      if (pending)
        throw new HttpError(
          409,
          'An earlier refund is still being processed. Please try again shortly.',
        );
      const paid =
        (fresh.walletUsed || 0) +
        (PAID_STATUSES.includes(fresh.paymentStatus) ? fresh.total : 0);
      if (amount > paid - fresh.refundedAmount)
        throw new HttpError(
          400,
          'This refund exceeds the amount still available to refund.',
        );
      const canReverse =
        fresh.paymentMethod === 'razorpay' &&
        fresh.razorpay.paymentId &&
        razorpayService.isEnabled();
      if (
        method === 'original' &&
        fresh.paymentMethod === 'razorpay' &&
        !canReverse
      )
        throw pendingError();
      const onlineRefunded = fresh.refunds
        .filter((entry) => entry.method === 'original')
        .reduce((sum, entry) => sum + entry.amount, 0);
      const toOriginal =
        method === 'original' && canReverse
          ? Math.max(0, Math.min(amount, fresh.total - onlineRefunded))
          : 0;
      const parts = [];
      if (toOriginal)
        parts.push({
          amount: toOriginal,
          method: 'original',
          status: 'pending',
          reason,
          operationKey,
        });
      if (amount > toOriginal)
        parts.push({
          amount: amount - toOriginal,
          method: 'wallet',
          status: 'processed',
          reason,
          operationKey,
        });
      const result = await Order.updateOne(
        {
          _id: fresh._id,
          __v: fresh.__v,
          refundOperations: {$not: {$elemMatch: {done: false}}},
        },
        {
          $push: {
            refundOperations: {
              key: operationKey,
              amount,
              method,
              reason,
              parts,
            },
          },
          $inc: {__v: 1},
        },
      );
      if (!result.modifiedCount)
        throw new HttpError(
          409,
          'The order changed. Please try the refund again.',
        );
    } else if (op.amount !== amount || op.method !== method) {
      throw new HttpError(
        409,
        'The earlier refund must finish before a different refund can be requested.',
      );
    }
    const parts = await execute(fresh._id, operationKey);
    fresh = await Order.findById(fresh._id);
    order.refundedAmount = fresh.refundedAmount;
    order.paymentStatus = fresh.paymentStatus;
    order.refunds = fresh.refunds;
    return parts;
  });
}
async function resume(orderId, key) {
  return runExclusive('refund:' + orderId, () => execute(orderId, key));
}
module.exports = {setWalletCredit, issueRefund, paymentStatusAfter, resume};
