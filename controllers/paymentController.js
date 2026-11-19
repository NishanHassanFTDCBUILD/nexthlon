const paymentService = require('../services/paymentService');
const webhookLogService = require('../services/webhookLogService');
const razorpay = require('../services/razorpayService');
const {validatePlaceOrder, hasErrors} = require('../utils/validators');
const {HttpError, asyncHandler} = require('../utils/http');

const RAZORPAY_ORDER = /^order_[A-Za-z0-9]{6,40}$/;
const RAZORPAY_PAYMENT = /^pay_[A-Za-z0-9]{6,40}$/;

function readIds(body = {}) {
  const razorpayOrderId =
    typeof body.razorpay_order_id === 'string'
      ? body.razorpay_order_id.trim()
      : '';
  const razorpayPaymentId =
    typeof body.razorpay_payment_id === 'string'
      ? body.razorpay_payment_id.trim()
      : '';
  const signature =
    typeof body.razorpay_signature === 'string'
      ? body.razorpay_signature.trim()
      : '';
  return {razorpayOrderId, razorpayPaymentId, signature};
}

// POST /api/payments/razorpay/order   body: { addressId, useWallet? }
// The coupon is the one chosen on the cart. Returns ONLY key_id, the Razorpay order id,
// the amount (paise) and the currency.
const createOrder = asyncHandler(async (req, res) => {
  const {errors, value} = validatePlaceOrder({
    ...req.body,
    paymentMethod: 'razorpay',
  });
  if (hasErrors(errors))
    throw new HttpError(400, Object.values(errors)[0], errors);
  const {checkout} = await paymentService.createPaymentOrder(req.user._id, {
    addressId: value.addressId,
    useWallet: value.useWallet,
    source: value.source,
  });
  res.status(201).json(checkout);
});

// POST /api/payments/razorpay/retry/:orderId
const retry = asyncHandler(async (req, res) => {
  const {checkout} = await paymentService.retryPayment(
    req.user._id,
    req.params.orderId,
  );
  res.json(checkout);
});

// POST /api/payments/razorpay/verify   body: { razorpay_order_id, razorpay_payment_id, razorpay_signature }
const verify = asyncHandler(async (req, res) => {
  const ids = readIds(req.body);
  if (
    !RAZORPAY_ORDER.test(ids.razorpayOrderId) ||
    !RAZORPAY_PAYMENT.test(ids.razorpayPaymentId) ||
    !ids.signature
  ) {
    throw new HttpError(
      400,
      'We could not confirm this payment: the details from the payment window were incomplete. Check your orders page; if money was taken it is refunded automatically.',
    );
  }
  const order = await paymentService.verifyPayment(req.user._id, ids);
  const ok =
    order.paymentStatus === 'paid' ||
    order.paymentStatus === 'refunded' ||
    order.paymentStatus === 'partially_refunded';
  res.json({
    message:
      order.orderStatus === 'cancelled'
        ? 'Payment received, but an item sold out. Your money is being refunded.'
        : 'Payment received. Thank you!',
    orderId: order.orderId,
    paid: ok,
    redirect:
      order.orderStatus === 'cancelled'
        ? `/orders/${order.orderId}`
        : `/orders/${order.orderId}/success`,
  });
});

// POST /api/payments/razorpay/failed   body: { razorpay_order_id, reason? }
const failed = asyncHandler(async (req, res) => {
  const {razorpayOrderId} = readIds(req.body);
  if (!RAZORPAY_ORDER.test(razorpayOrderId))
    throw new HttpError(400, 'Unknown payment.');
  const reason = typeof req.body.reason === 'string' ? req.body.reason : '';
  const order = await paymentService.markFailed(razorpayOrderId, {
    userId: req.user._id,
    reason,
  });
  if (!order) throw new HttpError(404, 'Order not found.');
  res.json({
    message:
      'The payment did not go through. Your cart is saved, and you can retry from the order page.',
    orderId: order.orderId,
    redirect: `/orders/${order.orderId}`,
  });
});

// GET /api/payments/razorpay/status/:razorpayOrderId   For polling after a dropped connection.
const status = asyncHandler(async (req, res) => {
  const razorpayOrderId = String(req.params.razorpayOrderId || '');
  if (!RAZORPAY_ORDER.test(razorpayOrderId))
    throw new HttpError(404, 'Order not found.');
  const order = await paymentService.getStatus(req.user._id, razorpayOrderId);
  res.json({
    orderId: order.orderId,
    paymentStatus: order.paymentStatus,
    orderStatus: order.orderStatus,
    amount: order.total,
    paid: ['paid', 'refunded', 'partially_refunded'].includes(
      order.paymentStatus,
    ),
    redirect: `/orders/${order.orderId}/success`,
  });
});

// POST /api/payments/razorpay/webhook   (raw JSON body, signed by Razorpay)
const webhook = async (req, res) => {
  const signature = req.get('x-razorpay-signature');
  const body = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
  const signatureOk = Boolean(
    razorpay.verifyWebhookSignature(req.body, signature),
  );
  try {
    await paymentService.handleWebhook(req.body, signature);
    await webhookLogService.record({
      provider: 'razorpay',
      rawBody: body,
      signature,
      signatureOk,
      outcome: 'processed',
    });
    res.json({ok: true});
  } catch (error) {
    const status = error.status && error.status < 500 ? error.status : 500;
    if (status >= 500) console.error('[payments] webhook error', error.message);
    await webhookLogService.record({
      provider: 'razorpay',
      rawBody: body,
      signature,
      signatureOk,
      outcome: webhookLogService.outcomeOf(error),
      error,
    });
    res.status(status).json({ok: false});
  }
};

module.exports = {createOrder, retry, verify, failed, status, webhook};
