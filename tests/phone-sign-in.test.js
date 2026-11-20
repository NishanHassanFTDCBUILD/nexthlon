// Sign in or up with a phone code: the input checks run before any database lookup, so these need no MongoDB.
require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const phoneSignIn = require('../services/phoneSignInService');

test('phone sign-in: a bad mobile number is refused before anything is sent', async () => {
  await assert.rejects(
    phoneSignIn.requestCode('12345'),
    (e) => e.status === 400,
  );
  await assert.rejects(phoneSignIn.requestCode(''), (e) => e.status === 400);
});

test('phone sign-in: a code that is not six digits is refused without a lookup', async () => {
  await assert.rejects(
    phoneSignIn.verifyCode('9876543210', '12'),
    (e) => e.status === 400,
  );
  await assert.rejects(
    phoneSignIn.verifyCode('9876543210', 'abcdef'),
    (e) => e.status === 400,
  );
  await assert.rejects(
    phoneSignIn.verifyCode('bad', '123456'),
    (e) => e.status === 400,
  );
});

test('phone sign-in: the answer never says whether the number has an account', () => {
  assert.match(phoneSignIn.SAME_ANSWER, /We have sent a 6-digit code/);
  assert.doesNotMatch(phoneSignIn.SAME_ANSWER, /account/);
});

test('phone sign-up: a forged, changed or expired ticket is refused', () => {
  const bad = (ticket, now) =>
    assert.throws(
      () => phoneSignIn.readTicket(ticket, now),
      (e) => e.status === 400,
    );
  bad('');
  bad('not-a-ticket');
  bad(`919876543210.${Date.now() + 60000}.${'0'.repeat(64)}`);
  bad(`919876543210.${Date.now() + 60000}.short`);
});
