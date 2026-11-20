// Sign in or up with a phone code, end to end. Own database ("_phone_signup"); runs only with TEST_MONGODB_URI.
require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');

if (!process.env.TEST_MONGODB_URI) {
  test(
    'phone sign-up database tests (set TEST_MONGODB_URI to run them)',
    {skip: true},
    () => {},
  );
  return;
}

const mongoose = require('mongoose');
const app = require('../app');
const User = require('../models/User');
const PhoneCode = require('../models/PhoneCode');
const messageService = require('../services/messageService');

const dbUrl = new URL(process.env.TEST_MONGODB_URI);
dbUrl.pathname = `${dbUrl.pathname.replace(/\/$/, '')}_phone_signup`;
let server;
let base;
const outbox = [];

async function call(method, url, body, cookie = '') {
  const headers = {
    Accept: 'application/json',
    Origin: base,
    'Content-Type': 'application/json',
  };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(base + url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const set =
    typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : [];
  return {
    status: res.status,
    cookies: set.map((line) => line.split(';')[0]).join('; '),
    data: await res.json().catch(() => ({})),
  };
}

const lastCode = (phone) =>
  [...outbox].reverse().find((m) => m.channel === 'otp' && m.to === phone).code;

// The 30-second wait between codes, skipped for the tests.
const allowResend = (phone) =>
  PhoneCode.updateMany({phone}, {$set: {lastSentAt: new Date(0)}});

test.before(async () => {
  if (!/test/i.test(dbUrl.pathname))
    throw new Error(
      "The phone sign-up test database must have 'test' in its name.",
    );
  await mongoose.connect(dbUrl.href);
  await mongoose.connection.dropDatabase();
  await Promise.all(
    Object.values(mongoose.models).map((model) => model.syncIndexes()),
  );
  messageService.useTestOutbox(outbox);
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  messageService.useTestOutbox(null);
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  await new Promise((resolve) => server.close(resolve));
});

test('phone sign-up: a new number gets a code, then a ticket, then an account signed in', async () => {
  const sent = await call('POST', '/api/auth/phone/request', {
    phone: '98765 43210',
  });
  assert.equal(sent.status, 200);
  const code = lastCode('919876543210');
  assert.match(code, /^\d{6}$/);

  const wrong = await call('POST', '/api/auth/phone/verify', {
    phone: '9876543210',
    code: code === '000000' ? '111111' : '000000',
  });
  assert.equal(wrong.status, 400);

  const verified = await call('POST', '/api/auth/phone/verify', {
    phone: '9876543210',
    code,
  });
  assert.equal(verified.status, 200);
  assert.equal(verified.data.needsProfile, true);
  assert.ok(verified.data.ticket);
  assert.equal(verified.cookies, '', 'not signed in before the account exists');

  const badEmail = await call('POST', '/api/auth/phone/signup', {
    ticket: verified.data.ticket,
    name: 'Phone Runner',
    email: 'not-an-email',
  });
  assert.equal(badEmail.status, 400);
  assert.ok(badEmail.data.errors.email);

  const made = await call('POST', '/api/auth/phone/signup', {
    ticket: verified.data.ticket,
    name: 'Phone Runner',
    email: 'phone.runner@signup.test',
  });
  assert.equal(made.status, 201);
  assert.match(made.cookies, /=/);
  const user = await User.findOne({email: 'phone.runner@signup.test'});
  assert.equal(user.phone, '9876543210');

  const again = await call('POST', '/api/auth/phone/signup', {
    ticket: verified.data.ticket,
    name: 'Second Try',
    email: 'second.try@signup.test',
  });
  assert.equal(again.status, 409, 'one ticket makes one account');
});

test('phone sign-in: a number with an account is signed in straight away', async () => {
  await allowResend('919876543210');
  await call('POST', '/api/auth/phone/request', {phone: '+91 98765 43210'});
  const verified = await call('POST', '/api/auth/phone/verify', {
    phone: '9876543210',
    code: lastCode('919876543210'),
  });
  assert.equal(verified.status, 200);
  assert.equal(verified.data.needsProfile, undefined);
  assert.equal(verified.data.user.name, 'Phone Runner');
  assert.match(verified.cookies, /=/);
});

test('phone sign-up: an email that already has an account is refused', async () => {
  await User.create({
    name: 'Email Owner',
    email: 'owner@signup.test',
    passwordHash: 'x'.repeat(60),
    role: 'customer',
    referralCode: 'OWNER123',
  });
  await call('POST', '/api/auth/phone/request', {phone: '9123456780'});
  const verified = await call('POST', '/api/auth/phone/verify', {
    phone: '9123456780',
    code: lastCode('919123456780'),
  });
  const taken = await call('POST', '/api/auth/phone/signup', {
    ticket: verified.data.ticket,
    name: 'Someone Else',
    email: 'owner@signup.test',
  });
  assert.equal(taken.status, 409);
  const owner = await User.findOne({email: 'owner@signup.test'});
  assert.equal(
    owner.phone,
    '',
    'the number is not added to someone else’s account',
  );
});

test('phone sign-in: a blocked account gets no code and cannot sign in', async () => {
  await User.updateOne({email: 'phone.runner@signup.test'}, {isBlocked: true});
  await allowResend('919876543210');
  const before = outbox.length;
  const sent = await call('POST', '/api/auth/phone/request', {
    phone: '9876543210',
  });
  assert.equal(sent.status, 200, 'same answer as any number');
  assert.equal(outbox.length, before, 'no text sent');
});
