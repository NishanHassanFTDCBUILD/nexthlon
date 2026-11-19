// Price-drop alerts: watch, sweep, and one email per drop. Own database (the test database name + "_pricealerts");
// runs only with TEST_MONGODB_URI.
require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');

if (!process.env.TEST_MONGODB_URI) {
  test(
    'price alert tests (set TEST_MONGODB_URI to run them)',
    {skip: true},
    () => {},
  );
  return;
}

const mongoose = require('mongoose');
const User = require('../models/User');
const Product = require('../models/Product');
const PriceWatch = require('../models/PriceWatch');
const priceAlertService = require('../services/priceAlertService');
const mailService = require('../services/mailService');

const dbUrl = new URL(process.env.TEST_MONGODB_URI);
dbUrl.pathname = `${dbUrl.pathname.replace(/\/$/, '')}_pricealerts`;

let shopper;
let racket;

test.before(async () => {
  await mongoose.connect(dbUrl.toString());
  await mongoose.connection.db.dropDatabase();
  await PriceWatch.syncIndexes();
  shopper = await User.create({
    name: 'Price Watcher',
    email: 'price.watcher@example.test',
    passwordHash: 'x'.repeat(60),
    role: 'customer',
  });
  racket = await Product.create({
    name: 'Test Racket',
    slug: 'test-racket',
    brand: 'Nexthlon',
    category: new mongoose.Types.ObjectId(),
    description: 'A racket for the price alert tests.',
    image: 'https://example.test/racket.jpg',
    basePrice: 349900,
    price: 349900,
    mrp: 399900,
    stock: 5,
  });
});

test.after(async () => {
  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
});

test('price alerts: asking to watch records the price at that time; asking again is fine', async () => {
  await priceAlertService.watch(shopper._id, racket._id);
  await priceAlertService.watch(shopper._id, racket._id);
  assert.equal(
    await PriceWatch.countDocuments({user: shopper._id, product: racket._id}),
    1,
  );
  assert.equal(
    await priceAlertService.isWatching(shopper._id, racket._id),
    true,
  );
  const row = await PriceWatch.findOne({user: shopper._id}).lean();
  assert.equal(row.price, 349900);
});

test('price alerts: a product that has not dropped sends nothing', async () => {
  assert.equal(await priceAlertService.sweep(), 0);
});

test('price alerts: a drop is emailed once, and the watch moves to the new price', async (t) => {
  const sent = [];
  t.mock.method(mailService, 'send', async (message) => {
    sent.push(message);
    return {ok: true};
  });
  await Product.updateOne({_id: racket._id}, {$set: {price: 299900}});
  assert.equal(await priceAlertService.sweep(), 1);
  const row = await PriceWatch.findOne({user: shopper._id}).lean();
  const result = await priceAlertService.notify(String(row._id));
  assert.equal(result, 'sent');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'price.watcher@example.test');
  assert.match(sent[0].subject, /Price drop: Test Racket/);
  assert.equal((await PriceWatch.findById(row._id).lean()).price, 299900);
  // The same drop again does nothing.
  assert.equal(await priceAlertService.notify(String(row._id)), 'not-lower');
  assert.equal(sent.length, 1);
});

test('price alerts: a failed send gives the drop back so it is tried again', async (t) => {
  await Product.updateOne({_id: racket._id}, {$set: {price: 249900}});
  const row = await PriceWatch.findOne({user: shopper._id}).lean();
  t.mock.method(mailService, 'send', async () => {
    throw new Error('mail down');
  });
  await assert.rejects(priceAlertService.notify(String(row._id)), /mail down/);
  assert.equal((await PriceWatch.findById(row._id).lean()).price, 299900);
});

test('price alerts: stopping the watch removes it, and nothing is sent after', async () => {
  await priceAlertService.unwatch(shopper._id, racket._id);
  assert.equal(
    await priceAlertService.isWatching(shopper._id, racket._id),
    false,
  );
  assert.equal(await priceAlertService.sweep(), 0);
});
