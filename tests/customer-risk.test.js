// Customer 360: the risk score and the timeline. Own database (the test database name + "_risk"); runs only with
// TEST_MONGODB_URI.
require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');

if (!process.env.TEST_MONGODB_URI) {
  test(
    'customer risk tests (set TEST_MONGODB_URI to run them)',
    {skip: true},
    () => {},
  );
  return;
}

const mongoose = require('mongoose');
const User = require('../models/User');
const Order = require('../models/Order');
const customerProfileService = require('../services/customerProfileService');

const dbUrl = new URL(process.env.TEST_MONGODB_URI);
dbUrl.pathname = `${dbUrl.pathname.replace(/\/$/, '')}_risk`;

let seq = 0;

test.before(async () => {
  await mongoose.connect(dbUrl.toString());
  await mongoose.connection.db.dropDatabase();
  await Order.syncIndexes();
});

test.after(async () => {
  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
});

async function customer(name) {
  return User.create({
    name,
    email: `${name.toLowerCase().replace(/\s/g, '.')}@example.test`,
    passwordHash: 'x'.repeat(60),
    role: 'customer',
  });
}

async function order(userId, extra = {}) {
  seq += 1;
  return Order.create({
    orderId: `NX-RISK-${seq}`,
    user: userId,
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
      name: 'Test',
      phone: '9876543210',
      line1: '1 Test Road',
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
    statusHistory: [{status: 'placed', by: 'customer', at: new Date()}],
    ...extra,
  });
}

test('risk: a customer with parcels sent back by the courier is high risk, with the reasons shown', async () => {
  const user = await customer('Courier Returns');
  await order(user._id, {
    rto: {stage: 'received', reason: 'Refused', at: new Date()},
  });
  await order(user._id, {
    rto: {stage: 'initiated', reason: 'Not home', at: new Date()},
  });
  const profile = await customerProfileService.profile(user._id);
  assert.equal(profile.risk.level, 'high');
  assert.ok(profile.risk.score >= 50);
  assert.ok(
    profile.risk.reasons.some((r) => /sent back by the courier/.test(r)),
  );
});

test('risk: a customer with no problems is low risk and told so', async () => {
  const user = await customer('Clean Record');
  await order(user._id);
  const profile = await customerProfileService.profile(user._id);
  assert.equal(profile.risk.level, 'low');
  assert.deepEqual(profile.risk.reasons, ['Nothing to flag']);
});

test('timeline: the order steps appear, newest first, with the customer and staff actions', async () => {
  const user = await customer('Timeline Person');
  const placed = await order(user._id, {
    statusHistory: [
      {status: 'placed', by: 'customer', at: new Date(Date.now() - 60000)},
      {status: 'delivered', by: 'admin', at: new Date()},
    ],
  });
  const profile = await customerProfileService.profile(user._id);
  const steps = profile.timeline.filter((t) => t.kind === 'order');
  assert.ok(steps.some((t) => t.text === `Order ${placed.orderId}: delivered`));
  for (let i = 1; i < profile.timeline.length; i += 1) {
    assert.ok(
      new Date(profile.timeline[i - 1].at) >= new Date(profile.timeline[i].at),
      'timeline is newest first',
    );
  }
});
