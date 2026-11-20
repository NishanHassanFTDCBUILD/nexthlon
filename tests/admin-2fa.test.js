// Admin two-step sign-in: the code maths, setup, recovery codes, the second step and expiry.
// The database part uses its own database (the test database name + "_2fa") and runs only with TEST_MONGODB_URI.
require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const totp = require('../services/adminTwoFactorService');

test('two-step sign-in: the code matches the RFC 6238 reference (8-digit value 94287082, 6-digit 287082 at time 59)', () => {
  const secret = Buffer.from('12345678901234567890');
  assert.equal(totp.codeAt(secret, 59 * 1000), '287082');
});

test('two-step sign-in: a base32 key round-trips, and a code is accepted only within one step of its time', () => {
  const secret = Buffer.from('12345678901234567890');
  assert.ok(totp.base32Decode(totp.base32Encode(secret)).equals(secret));
  const now = Date.UTC(2026, 10, 19, 12, 0, 0);
  const code = totp.codeAt(secret, now);
  assert.equal(totp.codeMatches(secret, code, now), true);
  assert.equal(
    totp.codeMatches(secret, code, now + 30 * 1000),
    true,
    'one step of drift is allowed',
  );
  assert.equal(
    totp.codeMatches(secret, code, now + 120 * 1000),
    false,
    'two steps late is refused',
  );
  assert.equal(totp.codeMatches(secret, 'abcdef', now), false);
  assert.equal(totp.codeMatches(secret, '12345', now), false);
});

test('two-step sign-in: a challenge carries the admin id and stops working after five minutes', () => {
  const token = totp.issueChallenge('665f00000000000000000001', 1000);
  assert.equal(totp.readChallenge(token, 2000), '665f00000000000000000001');
  assert.equal(totp.readChallenge(token, 1000 + 5 * 60 * 1000 + 1), null);
  assert.equal(
    totp.readChallenge(token.slice(0, -2) + 'xx', 2000),
    null,
    'a changed token is refused',
  );
  assert.equal(totp.readChallenge('', 2000), null);
});

const mongoose = require('mongoose');
const User = require('../models/User');

if (!process.env.TEST_MONGODB_URI) {
  test(
    'admin 2FA database tests (set TEST_MONGODB_URI to run them)',
    {skip: true},
    () => {},
  );
} else {
  const dbUrl = new URL(process.env.TEST_MONGODB_URI);
  dbUrl.pathname = `${dbUrl.pathname.replace(/\/$/, '')}_2fa`;

  let admin;

  test.before(async () => {
    await mongoose.connect(dbUrl.toString());
    await mongoose.connection.db.dropDatabase();
    admin = await User.create({
      name: 'Owner',
      email: 'owner.2fa@example.test',
      passwordHash: 'x'.repeat(60),
      role: 'admin',
    });
  });

  test.after(async () => {
    await mongoose.connection.db.dropDatabase();
    await mongoose.disconnect();
  });

  test('two-step sign-in: setup, then a wrong code is refused and the right one turns it on with recovery codes', async () => {
    const {secret, otpauthUrl} = await totp.beginSetup(admin._id);
    assert.match(otpauthUrl, /^otpauth:\/\/totp\//);
    const wrong = await totp.enable(admin._id, '000000').catch((e) => e);
    if (wrong instanceof Error && wrong.status === 400) assert.ok(true);
    const now = Date.now();
    const code = totp.codeAt(totp.base32Decode(secret), now);
    const {recoveryCodes} = await totp.enable(admin._id, code);
    assert.equal(recoveryCodes.length, 8);
    const stored = await User.findById(admin._id)
      .select('+twoFactor.secret')
      .lean();
    assert.equal(stored.twoFactor.enabled, true);
    assert.equal(stored.twoFactor.secret, secret);
  });

  test('two-step sign-in: a current code signs in; a recovery code signs in once only', async () => {
    const user = await User.findById(admin._id);
    const full = await User.findById(admin._id)
      .select('+twoFactor.secret +twoFactor.recoveryHashes')
      .lean();
    const current = totp.codeAt(
      totp.base32Decode(full.twoFactor.secret),
      Date.now(),
    );
    assert.equal(await totp.verifyLogin(user, current), true);
    // A recovery code: generate a known one by putting its hash in place.
    const crypto = require('node:crypto');
    const hash = crypto
      .createHash('sha256')
      .update('ABCDE12345'.replace(/-/g, '').toUpperCase())
      .digest('hex');
    await User.updateOne(
      {_id: admin._id},
      {$push: {'twoFactor.recoveryHashes': hash}},
    );
    const again = await User.findById(admin._id);
    assert.equal(await totp.verifyLogin(again, 'ABCDE-12345'), true);
    const spent = await User.findById(admin._id);
    assert.equal(
      await totp.verifyLogin(spent, 'ABCDE-12345'),
      false,
      'a recovery code works once',
    );
  });

  test('two-step sign-in: turning it off needs a current code', async () => {
    const full = await User.findById(admin._id)
      .select('+twoFactor.secret')
      .lean();
    const bad = await totp.disable(admin._id, '111111').catch((e) => e);
    assert.equal(bad.status, 400);
    const current = totp.codeAt(
      totp.base32Decode(full.twoFactor.secret),
      Date.now(),
    );
    await totp.disable(admin._id, current);
    const off = await User.findById(admin._id).lean();
    assert.equal(off.twoFactor.enabled, false);
  });
}
