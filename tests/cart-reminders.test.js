// Abandoned-cart reminders: one at 1 hour, one at 24 hours, never twice for the same cart, never to people who
// turned offers off. Own database (the test database name + "_cartreminders"); runs only with TEST_MONGODB_URI.
require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');

if (!process.env.TEST_MONGODB_URI) {
  test(
    'cart reminder tests (set TEST_MONGODB_URI to run them)',
    {skip: true},
    () => {},
  );
  return;
}

const mongoose = require('mongoose');
const User = require('../models/User');
const Cart = require('../models/Cart');
const Product = require('../models/Product');
const mailService = require('../services/mailService');
const cartReminderService = require('../services/cartReminderService');

const dbUrl = new URL(process.env.TEST_MONGODB_URI);
dbUrl.pathname = `${dbUrl.pathname.replace(/\/$/, '')}_cartreminders`;

const HOUR = 60 * 60 * 1000;
let product;

test.before(async () => {
  await mongoose.connect(dbUrl.toString());
  await mongoose.connection.db.dropDatabase();
  product = await Product.create({
    name: 'Reminder Racket',
    slug: 'reminder-racket',
    brand: 'Nexthlon',
    category: new mongoose.Types.ObjectId(),
    description: 'For the cart reminder tests.',
    image: 'https://example.test/r.jpg',
    basePrice: 99900,
    price: 99900,
    mrp: 119900,
    stock: 9,
  });
});

test.after(async () => {
  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
});

// A customer with a cart last changed `hoursAgo` hours before `now`.
async function shopperWithCart(name, hoursAgo, now, prefs = {}) {
  const user = await User.create({
    name,
    email: `${name.toLowerCase().replace(/\s/g, '.')}@example.test`,
    passwordHash: 'x'.repeat(60),
    role: 'customer',
    notifyPrefs: prefs,
  });
  const cart = await Cart.create({
    user: user._id,
    items: [{product: product._id, quantity: 1}],
  });
  // Set the change time directly, so the test controls how old the cart is.
  await Cart.collection.updateOne(
    {_id: cart._id},
    {$set: {updatedAt: new Date(now.getTime() - hoursAgo * HOUR)}},
  );
  return {user, cart};
}

test('reminders: a cart left for an hour gets one reminder, and not a second one on the next run', async (t) => {
  const sent = [];
  t.mock.method(mailService, 'send', async (m) => {
    sent.push(m);
    return {ok: true};
  });
  const now = new Date();
  const {user} = await shopperWithCart('Hour Shopper', 2, now);
  assert.equal(await cartReminderService.sweep(now), 1);
  assert.equal(await cartReminderService.sweep(now), 0);
  const mine = sent.filter((m) => m.to === user.email);
  assert.equal(mine.length, 1);
  assert.match(mine[0].subject, /left something in your cart/);
});

test('reminders: a cart left a day gets its second reminder once, after the first', async (t) => {
  const sent = [];
  t.mock.method(mailService, 'send', async (m) => {
    sent.push(m);
    return {ok: true};
  });
  const now = new Date();
  const {user, cart} = await shopperWithCart('Day Shopper', 2, now);
  await cartReminderService.sweep(now);
  // Later: the cart is now 25 hours old, still the same version.
  const later = new Date(now.getTime() + 23 * HOUR);
  await cartReminderService.sweep(later);
  await cartReminderService.sweep(later);
  const mine = sent.filter((m) => m.to === user.email);
  assert.equal(
    mine.length,
    2,
    'one first reminder and one second, never a repeat',
  );
  assert.match(mine[1].subject, /Still in your cart/);
  assert.ok(cart);
});

test('reminders: a customer who turned offers off gets none', async (t) => {
  const sent = [];
  t.mock.method(mailService, 'send', async (m) => {
    sent.push(m);
    return {ok: true};
  });
  const now = new Date();
  const {user} = await shopperWithCart('Quiet Shopper', 2, now, {
    offers: false,
  });
  await cartReminderService.sweep(now);
  assert.equal(sent.filter((m) => m.to === user.email).length, 0);
});

test('reminders: changing the cart starts a new cycle, so the new cart gets its own reminder', async (t) => {
  const sent = [];
  t.mock.method(mailService, 'send', async (m) => {
    sent.push(m);
    return {ok: true};
  });
  const now = new Date();
  const {user, cart} = await shopperWithCart('Changed Cart', 2, now);
  await cartReminderService.sweep(now);
  // The customer changes the cart later: a new change time, one hour old.
  await Cart.collection.updateOne(
    {_id: cart._id},
    {$set: {updatedAt: new Date(now.getTime() + HOUR)}},
  );
  const later = new Date(now.getTime() + 2 * HOUR);
  await cartReminderService.sweep(later);
  assert.equal(sent.filter((m) => m.to === user.email).length, 2);
});

test('reminders: a failed send gives the claim back, so it is tried again', async (t) => {
  const now = new Date();
  const {user} = await shopperWithCart('Failing Mail', 2, now);
  t.mock.method(mailService, 'send', async () => {
    throw new Error('mail down');
  });
  assert.equal(await cartReminderService.sweep(now), 0);
  t.mock.restoreAll();
  const sent = [];
  t.mock.method(mailService, 'send', async (m) => {
    sent.push(m);
    return {ok: true};
  });
  assert.equal(await cartReminderService.sweep(now), 1);
  assert.equal(sent[0].to, user.email);
});
