// Real MongoDB checks for the atomic operations used by recovery. Own disposable
// database only; never points at the store configured in .env.
require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
if (!process.env.TEST_MONGODB_URI) {
  test(
    'commerce database tests (set TEST_MONGODB_URI to run them)',
    {skip: true},
    () => {},
  );
  return;
}
const mongoose = require('mongoose');
const Product = require('../models/Product');
const Order = require('../models/Order');
const Wallet = require('../models/Wallet');
const WalletTransaction = require('../models/WalletTransaction');
const stock = require('../services/stockService');
const wallet = require('../services/walletService');
const refunds = require('../services/refundService');
const counters = require('../services/counterService');
const gst = require('../services/gstService');
const events = require('../events');
const db = new URL(process.env.TEST_MONGODB_URI);
if (!/test/i.test(db.pathname))
  throw new Error('Commerce tests require a database name containing test.');
db.pathname += '_commerce_recovery';
test.before(async () => {
  await mongoose.connect(db.href);
  await mongoose.connection.dropDatabase();
  await Promise.all(
    Object.values(mongoose.models).map((model) => model.syncIndexes()),
  );
});
test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});
let sequence = 0;
const owner = new mongoose.Types.ObjectId();
async function product(stockCount = 3) {
  sequence++;
  return Product.create({
    name: 'Recovery Ball',
    slug: `recovery-ball-${sequence}`,
    category: new mongoose.Types.ObjectId(),
    basePrice: 10000,
    mrp: 10000,
    stock: stockCount,
    image: '/img/favicon.svg',
  });
}
async function order() {
  const ball = await product();
  return Order.create({
    orderId: `NX-2026-${String(sequence).padStart(6, '0')}`,
    user: owner,
    items: [
      {
        product: ball._id,
        name: ball.name,
        slug: ball.slug,
        price: 10000,
        mrp: 10000,
        quantity: 1,
        lineTotal: 10000,
      },
    ],
    address: {fullName: 'Test customer'},
    mrpTotal: 10000,
    subtotal: 10000,
    total: 10000,
    paymentMethod: 'wallet',
    paymentStatus: 'paid',
    stockReserved: true,
  });
}

test('stock receipts prevent duplicate reservation and restoration across callers', async () => {
  const ball = await product();
  const lines = [{product: ball._id, quantity: 1, name: ball.name}];
  await Promise.all([
    stock.takeStockOnce(lines, 'reserve'),
    stock.takeStockOnce(lines, 'reserve'),
  ]);
  assert.equal((await Product.findById(ball._id)).stock, 2);
  await Promise.all([
    stock.returnStockOnce(lines, 'restore'),
    stock.returnStockOnce(lines, 'restore'),
  ]);
  assert.equal((await Product.findById(ball._id)).stock, 3);
});

test('partial stock reservation rollback only returns stock that was taken', async () => {
  const first = await product(2);
  const empty = await product(0);
  const lines = [first, empty].map((ball) => ({
    product: ball._id,
    quantity: 1,
    name: ball.name,
  }));
  await assert.rejects(stock.takeStockOnce(lines, 'partial'));
  await stock.returnStockOnce(lines, 'rollback', 'partial');
  await stock.returnStockOnce(lines, 'rollback', 'partial');
  assert.equal((await Product.findById(first._id)).stock, 2);
  assert.equal((await Product.findById(empty._id)).stock, 0);
});

test('wallet retry repairs history after a lost write without a second credit', async (t) => {
  const user = new mongoose.Types.ObjectId();
  const original = WalletTransaction.updateOne.bind(WalletTransaction);
  let fail = true;
  t.mock.method(WalletTransaction, 'updateOne', (...args) => {
    if (fail) {
      fail = false;
      throw new Error('history unavailable');
    }
    return original(...args);
  });
  await assert.rejects(
    wallet.credit(user, 10000, {reason: 'Test refund', key: 'wallet-failure'}),
  );
  await wallet.credit(user, 10000, {
    reason: 'Test refund',
    key: 'wallet-failure',
  });
  assert.equal((await Wallet.findOne({user})).balance, 10000);
  assert.equal(
    await WalletTransaction.countDocuments({key: 'wallet-failure'}),
    1,
  );
  assert.equal(
    (await WalletTransaction.findOne({key: 'wallet-failure'})).applied,
    true,
  );
});

test('duplicate refund requests record one refund and credit once', async (t) => {
  t.mock.method(events, 'emit', async () => true);
  const placed = await order();
  await Promise.all([
    refunds.issueRefund(placed, 10000, {key: 'same-refund'}),
    refunds.issueRefund(placed, 10000, {key: 'same-refund'}),
  ]);
  const updated = await Order.findById(placed._id);
  assert.equal(updated.refundedAmount, 10000);
  assert.equal(updated.refunds.length, 1);
  assert.equal(updated.refundOperations[0].done, true);
});

test('stale order snapshots cannot both save a business transition', async () => {
  const placed = await order();
  const a = await Order.findById(placed._id);
  const b = await Order.findById(placed._id);
  a.orderStatus = 'cancelled';
  b.orderStatus = 'confirmed';
  await a.save();
  await assert.rejects(b.save(), (error) => error.name === 'VersionError');
});

test('invoice counter allocations survive concurrent retries without consuming numbers', async () => {
  const values = await Promise.all([
    counters.numberFor('invoice-test', 'same'),
    counters.numberFor('invoice-test', 'same'),
  ]);
  assert.deepEqual(values, [1, 1]);
  assert.equal(await counters.numberFor('invoice-test', 'next'), 2);
});

test('invoice numbering resumes a previously saved pending invoice', async () => {
  const placed = await order();
  await Order.updateOne(
    {_id: placed._id},
    {
      $set: {
        gst: {
          scheme: 'regular',
          invoiceNo: `pending:${placed._id}`,
          invoiceDate: new Date('2026-11-17'),
        },
      },
    },
  );
  const issued = await gst.issueInvoice(placed._id);
  assert.match(issued.gst.invoiceNo, /^NX\/26-27\/\d{6}$/);
  assert.equal(
    (await gst.issueInvoice(placed._id)).gst.invoiceNo,
    issued.gst.invoiceNo,
  );
});
