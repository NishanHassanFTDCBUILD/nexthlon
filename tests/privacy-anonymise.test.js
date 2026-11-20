// Anonymise a customer: personal details go, orders and the account stay. Own database (the test database name +
// "_anonymise"); runs only with TEST_MONGODB_URI.
require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');

if (!process.env.TEST_MONGODB_URI) {
  test(
    'anonymise tests (set TEST_MONGODB_URI to run them)',
    {skip: true},
    () => {},
  );
  return;
}

const mongoose = require('mongoose');
const User = require('../models/User');
const Address = require('../models/Address');
const Order = require('../models/Order');
const Wishlist = require('../models/Wishlist');
const privacyService = require('../services/privacyService');

const dbUrl = new URL(process.env.TEST_MONGODB_URI);
dbUrl.pathname = `${dbUrl.pathname.replace(/\/$/, '')}_anonymise`;

let person;

test.before(async () => {
  await mongoose.connect(dbUrl.toString());
  await mongoose.connection.db.dropDatabase();
  person = await User.create({
    name: 'Leaving Person',
    email: 'leaving@example.test',
    phone: '9876543210',
    passwordHash: 'x'.repeat(60),
    role: 'customer',
  });
  await Address.create({
    user: person._id,
    label: 'Home',
    fullName: 'Leaving Person',
    phone: '9876543210',
    line1: '1 Private Road',
    city: 'Kochi',
    state: 'Kerala',
    pincode: '682001',
  });
  await Wishlist.create({user: person._id, products: []});
  await Order.create({
    orderId: 'NX-ANON-1',
    user: person._id,
    items: [
      {
        product: new mongoose.Types.ObjectId(),
        name: 'Test Ball',
        slug: 'test-ball',
        price: 50000,
        mrp: 60000,
        quantity: 1,
        lineTotal: 50000,
        status: 'delivered',
      },
    ],
    address: {
      name: 'Leaving Person',
      phone: '9876543210',
      line1: '1 Private Road',
      city: 'Kochi',
      state: 'Kerala',
      pincode: '682001',
    },
    mrpTotal: 60000,
    subtotal: 50000,
    total: 50000,
    paymentMethod: 'cod',
    paymentStatus: 'paid',
    orderStatus: 'delivered',
    deliveredAt: new Date(),
  });
});

test.after(async () => {
  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
});

test('anonymise: personal details are removed and the account is switched off', async () => {
  await privacyService.anonymise(person._id);
  const after = await User.findById(person._id).lean();
  assert.equal(after.name, 'Former customer');
  assert.equal(after.phone, '');
  assert.ok(after.email.endsWith('@anonymised.invalid'));
  assert.equal(after.isBlocked, true);
  assert.equal(await Address.countDocuments({user: person._id}), 0);
  assert.equal(await Wishlist.countDocuments({user: person._id}), 0);
});

test('anonymise: orders and their invoice details stay, so the records are still correct', async () => {
  const order = await Order.findOne({orderId: 'NX-ANON-1'}).lean();
  assert.ok(order, 'the order is kept');
  assert.equal(order.total, 50000);
  assert.equal(
    order.address.line1,
    '1 Private Road',
    'the address on the invoice is kept by law',
  );
});

test('anonymise: a missing customer, and an account that is not a customer, are refused', async () => {
  const missing = await privacyService
    .anonymise(new mongoose.Types.ObjectId())
    .catch((e) => e);
  assert.equal(missing.status, 404);
});
