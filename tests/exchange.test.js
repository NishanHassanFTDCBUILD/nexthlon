// Size exchange: the request, stock held on approval, completion (old size back, new size on the item), and the
// refusals. Uses its own database (the test database name + "_exchange") and runs only with TEST_MONGODB_URI.
require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');

if (!process.env.TEST_MONGODB_URI) {
  test(
    'exchange tests (set TEST_MONGODB_URI to run them)',
    {skip: true},
    () => {},
  );
  return;
}

const mongoose = require('mongoose');
const User = require('../models/User');
const Product = require('../models/Product');
const Order = require('../models/Order');
const exchangeService = require('../services/exchangeService');

const dbUrl = new URL(process.env.TEST_MONGODB_URI);
dbUrl.pathname = `${dbUrl.pathname.replace(/\/$/, '')}_exchange`;

let customer;
let shoe;
let sizeNine;
let sizeTen;
let sizeEleven;
let orderSeq = 0;

test.before(async () => {
  await mongoose.connect(dbUrl.toString());
  await mongoose.connection.db.dropDatabase();
  await Order.syncIndexes();
  customer = await User.create({
    name: 'Exchange Customer',
    email: 'exchange.customer@example.test',
    passwordHash: 'x'.repeat(60),
    role: 'customer',
  });
  shoe = await Product.create({
    name: 'Test Court Shoe',
    slug: 'test-court-shoe',
    brand: 'Nexthlon',
    category: new mongoose.Types.ObjectId(),
    description: 'A court shoe for the exchange tests.',
    image: 'https://example.test/shoe.jpg',
    basePrice: 299900,
    price: 299900,
    mrp: 349900,
    stock: 0,
    variants: [
      {size: '9', stock: 4},
      {size: '10', stock: 2},
      {size: '11', stock: 0},
    ],
  });
  sizeNine = shoe.variants[0];
  sizeTen = shoe.variants[1];
  sizeEleven = shoe.variants[2];
});

test.after(async () => {
  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
});

// A delivered order for one pair of size 9.
async function deliveredOrder(now = new Date()) {
  orderSeq += 1;
  const order = await Order.create({
    orderId: `NX-EXCH-${orderSeq}`,
    user: customer._id,
    items: [
      {
        product: shoe._id,
        variant: sizeNine._id,
        option: 'Size 9',
        name: shoe.name,
        slug: shoe.slug,
        brand: shoe.brand,
        image: shoe.image,
        price: shoe.price,
        mrp: shoe.mrp,
        quantity: 1,
        lineTotal: shoe.price,
        status: 'delivered',
      },
    ],
    address: {
      name: 'Exchange Customer',
      phone: '9876543210',
      line1: '1 Test Road',
      city: 'Kochi',
      state: 'Kerala',
      pincode: '682001',
    },
    mrpTotal: shoe.mrp,
    subtotal: shoe.price,
    total: shoe.price,
    paymentMethod: 'cod',
    paymentStatus: 'paid',
    orderStatus: 'delivered',
    deliveredAt: now,
  });
  return order;
}

const stockOf = async (variantId) => {
  const fresh = await Product.findById(shoe._id).lean();
  return fresh.variants.find((v) => String(v._id) === String(variantId)).stock;
};

test('exchange: a delivered item can ask for another size; nothing is held until the team approves', async () => {
  const order = await deliveredOrder();
  const before = await stockOf(sizeTen._id);
  await exchangeService.requestExchange(
    customer._id,
    order.orderId,
    order.items[0]._id,
    sizeTen._id,
  );
  const saved = await Order.findById(order._id).lean();
  assert.equal(saved.items[0].exchange.status, 'requested');
  assert.equal(String(saved.items[0].exchange.variant), String(sizeTen._id));
  assert.equal(await stockOf(sizeTen._id), before, 'stock is not taken yet');
});

test('exchange: asking twice while one is open is refused', async () => {
  const order = await deliveredOrder();
  await exchangeService.requestExchange(
    customer._id,
    order.orderId,
    order.items[0]._id,
    sizeTen._id,
  );
  const again = await exchangeService
    .requestExchange(
      customer._id,
      order.orderId,
      order.items[0]._id,
      sizeTen._id,
    )
    .catch((e) => e);
  assert.equal(again.status, 409);
});

test('exchange: an out of stock size, the same size, and an item not yet delivered are refused', async () => {
  const order = await deliveredOrder();
  const outOfStock = await exchangeService
    .requestExchange(
      customer._id,
      order.orderId,
      order.items[0]._id,
      sizeEleven._id,
    )
    .catch((e) => e);
  assert.equal(outOfStock.status, 409);
  const same = await exchangeService
    .requestExchange(
      customer._id,
      order.orderId,
      order.items[0]._id,
      sizeNine._id,
    )
    .catch((e) => e);
  assert.equal(same.status, 400);

  const packed = await deliveredOrder();
  await Order.updateOne(
    {_id: packed._id},
    {$set: {'items.0.status': 'shipped'}},
  );
  const notDelivered = await exchangeService
    .requestExchange(
      customer._id,
      packed.orderId,
      packed.items[0]._id,
      sizeTen._id,
    )
    .catch((e) => e);
  assert.equal(notDelivered.status, 400);
});

test('exchange: approval takes the new size from stock; completion returns the old size and moves the item', async () => {
  const order = await deliveredOrder();
  const itemId = order.items[0]._id;
  await exchangeService.requestExchange(
    customer._id,
    order.orderId,
    itemId,
    sizeTen._id,
  );

  const tenBefore = await stockOf(sizeTen._id);
  const nineBefore = await stockOf(sizeNine._id);
  await exchangeService.decideExchange(order.orderId, itemId, 'approve');
  assert.equal(
    await stockOf(sizeTen._id),
    tenBefore - 1,
    'the new size is held',
  );
  assert.equal(
    await stockOf(sizeNine._id),
    nineBefore,
    'the old size is not back yet',
  );

  await exchangeService.completeExchange(order.orderId, itemId);
  assert.equal(
    await stockOf(sizeNine._id),
    nineBefore + 1,
    'the old size is back on the shelf',
  );
  const done = await Order.findById(order._id).lean();
  assert.equal(done.items[0].exchange.status, 'completed');
  assert.equal(String(done.items[0].variant), String(sizeTen._id));
  assert.equal(done.items[0].option, 'Size 10');
  const actions = done.statusHistory.map((h) => h.status);
  assert.ok(actions.includes('exchange_requested'));
  assert.ok(actions.includes('exchange_approved'));
  assert.ok(actions.includes('exchange_completed'));
});

test('exchange: a declined request holds nothing and cannot be completed', async () => {
  const order = await deliveredOrder();
  const itemId = order.items[0]._id;
  await exchangeService.requestExchange(
    customer._id,
    order.orderId,
    itemId,
    sizeTen._id,
  );
  const tenBefore = await stockOf(sizeTen._id);
  await exchangeService.decideExchange(order.orderId, itemId, 'decline');
  assert.equal(await stockOf(sizeTen._id), tenBefore);
  const finish = await exchangeService
    .completeExchange(order.orderId, itemId)
    .catch((e) => e);
  assert.equal(finish.status, 409);
});

test('exchange: only the owner can ask, and a decision needs a request waiting', async () => {
  const order = await deliveredOrder();
  const stranger = new mongoose.Types.ObjectId();
  const notOwner = await exchangeService
    .requestExchange(stranger, order.orderId, order.items[0]._id, sizeTen._id)
    .catch((e) => e);
  assert.equal(notOwner.status, 404);
  const nothingAsked = await exchangeService
    .decideExchange(order.orderId, order.items[0]._id, 'approve')
    .catch((e) => e);
  assert.equal(nothingAsked.status, 409);
});
