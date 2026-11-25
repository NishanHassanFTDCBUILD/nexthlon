require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const {ORDER_WORK_QUEUES} = require('../config/orderWorkQueues');
const adminOrders = require('../services/adminOrderService');
const Order = require('../models/Order');
const User = require('../models/User');

test('work queues apply identical predicates to order lists and exports', async (t) => {
  const captured = [];
  t.mock.method(Order, 'find', (filter) => {
    captured.push(filter);
    const chain = {
      sort: () => chain,
      skip: () => chain,
      limit: () => chain,
      select: () => chain,
      lean: () => chain,
      then: (resolve) => Promise.resolve([]).then(resolve),
      cursor: () => (async function* () {})(),
    };
    return chain;
  });
  t.mock.method(Order, 'countDocuments', async () => 0);
  t.mock.method(Order, 'aggregate', async () => []);
  for (const queue of ORDER_WORK_QUEUES) {
    await adminOrders.listOrders({queue: queue.key});
    await adminOrders.exportOrders({queue: queue.key});
    const pair = captured.slice(-2);
    assert.deepEqual(pair[0].$and, [queue.filter()]);
    assert.deepEqual(pair[1], pair[0]);
  }
});

test('queue and customer searches combine rather than overwrite each other', async (t) => {
  let query;
  t.mock.method(Order, 'find', (filter) => {
    query = filter;
    const chain = {
      sort: () => chain,
      skip: () => chain,
      limit: () => chain,
      select: () => chain,
      lean: async () => [],
    };
    return chain;
  });
  t.mock.method(Order, 'countDocuments', async () => 0);
  t.mock.method(Order, 'aggregate', async () => []);
  t.mock.method(User, 'find', () => {
    const chain = {
      select: () => chain,
      limit: () => chain,
      lean: async () => [],
    };
    return chain;
  });
  const result = await adminOrders.listOrders({queue: 'dispatch', q: 'Buyer'});
  assert.equal(result.filters.queue, 'dispatch');
  assert.equal(query.$and[0].orderStatus, 'confirmed');
  assert.equal(query.$and[0].$or.length, 2);
  assert.ok(query.$or.some((part) => part['address.fullName']));
  assert.equal(
    adminOrders.readOrderFilters({queue: 'not-a-queue'}).queue,
    'all',
  );
});

test('profile order updates are owner-scoped, bounded and expose only useful summary fields', async (t) => {
  let filter;
  let limit;
  let selection;
  t.mock.method(Order, 'find', (query) => {
    filter = query;
    const chain = {
      sort: () => chain,
      limit: (value) => {
        limit = value;
        return chain;
      },
      select: (value) => {
        selection = value;
        return chain;
      },
      lean: async () => [
        {
          orderId: 'NX-2026-100001',
          orderStatus: 'placed',
          paymentMethod: 'razorpay',
          paymentStatus: 'pending',
          items: [{status: 'placed'}],
        },
      ],
    };
    return chain;
  });
  const updates = await require('../services/accountUpdatesService').forUser(
    'buyer-id',
  );
  assert.equal(filter.user, 'buyer-id');
  assert.equal(limit, 4);
  assert.ok(filter.$or.some((part) => part.refunds));
  assert.ok(!selection.includes('address'));
  assert.equal(updates[0].title, 'Payment required');
  assert.equal(updates[0].action, 'Complete payment');
  assert.equal(updates[0].href, '/orders/NX-2026-100001');
  assert.equal(updates[0].paymentId, undefined);
});
