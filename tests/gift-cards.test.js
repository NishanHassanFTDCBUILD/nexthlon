// Gift cards: redeeming into the wallet, one use per code, switching off, expiry. Uses its own database
// (the test database name + "_giftcards") and runs only when TEST_MONGODB_URI is set.
require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');

if (!process.env.TEST_MONGODB_URI) {
  test(
    'gift card tests (set TEST_MONGODB_URI to run them)',
    {skip: true},
    () => {},
  );
  return;
}

const mongoose = require('mongoose');
const User = require('../models/User');
const GiftCard = require('../models/GiftCard');
const WalletTransaction = require('../models/WalletTransaction');
const giftCardService = require('../services/giftCardService');
const walletService = require('../services/walletService');

const dbUrl = new URL(process.env.TEST_MONGODB_URI);
dbUrl.pathname = `${dbUrl.pathname.replace(/\/$/, '')}_giftcards`;

let buyer;

test.before(async () => {
  await mongoose.connect(dbUrl.toString());
  await mongoose.connection.db.dropDatabase();
  await GiftCard.syncIndexes();
  buyer = await User.create({
    name: 'Gift Buyer',
    email: 'gift.buyer@example.test',
    passwordHash: 'x'.repeat(60),
    role: 'customer',
  });
});

test.after(async () => {
  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
});

const expiresIn = (days) => new Date(Date.now() + days * 24 * 60 * 60 * 1000);

test('gift card codes: 12 letters and digits, shown in groups of four; typed codes are tidied up', () => {
  const code = giftCardService.newCode();
  assert.match(code, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal(
    giftCardService.formatCode(' abcd 2345-wxyz '),
    'ABCD-2345-WXYZ',
  );
  assert.equal(giftCardService.formatCode('too short'), '');
});

test('redeeming a gift card adds its value to the wallet, once', async () => {
  const card = await GiftCard.create({
    code: 'ABCD-2345-WXYZ',
    amount: 50000,
    expiresAt: expiresIn(365),
  });
  const reply = await giftCardService.redeem(buyer._id, 'abcd2345wxyz');
  assert.equal(reply.amount, 50000);
  assert.equal(await walletService.getBalance(buyer._id), 50000);

  const again = await giftCardService
    .redeem(buyer._id, 'ABCD-2345-WXYZ')
    .catch((e) => e);
  assert.equal(again.status, 400);
  assert.equal(
    await walletService.getBalance(buyer._id),
    50000,
    'a second use adds nothing',
  );

  const stored = await GiftCard.findById(card._id).lean();
  assert.equal(stored.status, 'redeemed');
  assert.equal(String(stored.redeemedBy), String(buyer._id));
  assert.equal(await WalletTransaction.countDocuments({kind: 'gift_card'}), 1);
});

test('gift cards: an expired card, an unknown code and a bad code are all refused', async () => {
  await GiftCard.create({
    code: 'EXPI-RED1-CODE',
    amount: 1000,
    expiresAt: expiresIn(-1),
  });
  const expired = await giftCardService
    .redeem(buyer._id, 'EXPI-RED1-CODE')
    .catch((e) => e);
  assert.equal(expired.status, 400);
  const unknown = await giftCardService
    .redeem(buyer._id, 'ZZZZ-ZZZZ-ZZZZ')
    .catch((e) => e);
  assert.equal(unknown.status, 400);
  const bad = await giftCardService.redeem(buyer._id, 'nope').catch((e) => e);
  assert.equal(bad.status, 400);
});

test('gift cards: a switched-off card cannot be redeemed; only active cards can be switched off', async () => {
  const card = await GiftCard.create({
    code: 'OFFF-CARD-0001',
    amount: 2000,
    expiresAt: expiresIn(365),
  });
  await giftCardService.disable(card._id);
  const refused = await giftCardService
    .redeem(buyer._id, 'OFFF-CARD-0001')
    .catch((e) => e);
  assert.equal(refused.status, 400);
  assert.equal(
    await walletService.getBalance(buyer._id),
    50000,
    'the wallet is untouched',
  );
  const twice = await giftCardService.disable(card._id).catch((e) => e);
  assert.equal(twice.status, 409);
});

test('gift cards: nothing is issued for an order that does not exist', async () => {
  assert.equal(await giftCardService.issueForOrder('NX-DOES-NOT-EXIST'), 0);
});
