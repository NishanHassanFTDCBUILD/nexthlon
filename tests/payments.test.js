// Payment signature checks. HMAC-SHA256 with the secret, compared in constant time.
require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const razorpay = require('../services/razorpayService');

const sign = (secret, text) =>
  crypto.createHmac('sha256', secret).update(text).digest('hex');

test('checkout signature: order_id|payment_id signed with the key secret', () => {
  const good = sign('test-key-secret', 'order_ABC123|pay_XYZ789');
  assert.equal(
    razorpay.verifyPaymentSignature('order_ABC123', 'pay_XYZ789', good),
    true,
  );
  assert.equal(
    razorpay.verifyPaymentSignature(
      'order_ABC123',
      'pay_XYZ789',
      good.toUpperCase(),
    ),
    true,
  );
  // Any change to the ids, the secret or the signature fails.
  assert.equal(
    razorpay.verifyPaymentSignature('order_ABC124', 'pay_XYZ789', good),
    false,
  );
  assert.equal(
    razorpay.verifyPaymentSignature(
      'order_ABC123',
      'pay_XYZ789',
      sign('wrong-secret', 'order_ABC123|pay_XYZ789'),
    ),
    false,
  );
  assert.equal(
    razorpay.verifyPaymentSignature(
      'order_ABC123',
      'pay_XYZ789',
      good.slice(0, 63),
    ),
    false,
  );
  assert.equal(
    razorpay.verifyPaymentSignature(
      'order_ABC123',
      'pay_XYZ789',
      'z'.repeat(64),
    ),
    false,
  );
  assert.equal(
    razorpay.verifyPaymentSignature('order_ABC123', 'pay_XYZ789', undefined),
    false,
  );
  assert.equal(
    razorpay.verifyPaymentSignature('order_ABC123', 'pay_XYZ789', {length: 64}),
    false,
  );
});

test('webhook signature: the raw body signed with the webhook secret', () => {
  const body = Buffer.from(JSON.stringify({event: 'payment.captured'}));
  const good = sign('test-webhook-secret', body);
  assert.equal(razorpay.verifyWebhookSignature(body, good), true);
  assert.equal(
    razorpay.verifyWebhookSignature(Buffer.from(body.toString() + ' '), good),
    false,
  );
  assert.equal(
    razorpay.verifyWebhookSignature(body, sign('test-key-secret', body)),
    false,
  );
  // A parsed object is not the raw body, so it never passes.
  assert.equal(razorpay.verifyWebhookSignature(JSON.parse(body), good), false);
});
