// Guest order tracking: the input checks and the phone matching. These run without a database;
// the lookup itself needs MongoDB and is covered by the database tests when TEST_MONGODB_URI is set.
const test = require('node:test');
const assert = require('node:assert/strict');
const {phoneDigits, NOT_FOUND} = require('../services/orderTrackingService');
const orderTrackingService = require('../services/orderTrackingService');

test('tracking: phone numbers match whatever their format (last ten digits)', () => {
  assert.equal(phoneDigits('9876543210'), '9876543210');
  assert.equal(phoneDigits('+91 98765 43210'), '9876543210');
  assert.equal(phoneDigits('098765-43210'), '9876543210');
  assert.equal(phoneDigits(undefined), '');
});

test('tracking: a missing order ID or a bad phone is refused before any lookup', async () => {
  await assert.rejects(
    orderTrackingService.track({orderId: '', phone: '9876543210'}),
    (error) => error.status === 400,
  );
  await assert.rejects(
    orderTrackingService.track({orderId: 'NX-1', phone: '12345'}),
    (error) => error.status === 400,
  );
  await assert.rejects(
    orderTrackingService.track({}),
    (error) => error.status === 400,
  );
});

test('tracking: a wrong order or phone gets one generic answer that reveals nothing', () => {
  assert.match(NOT_FOUND, /could not find an order/);
  assert.doesNotMatch(NOT_FOUND, /phone number is wrong|no such order/i);
});
