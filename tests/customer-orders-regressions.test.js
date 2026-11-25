require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const Order = require('../models/Order');
const exchanges = require('../services/exchangeService');
const {viewLocals} = require('../middleware/viewLocals');
const orders = require('../services/orderService');

function fixture(status = 'delivered') {
  return new Order({
    _id: '000000000000000000000001',
    user: '000000000000000000000009',
    orderId: 'NX-2026-100001',
    orderStatus: status,
    paymentMethod: 'cod',
    paymentStatus: 'paid',
    createdAt: new Date(),
    deliveredAt: status === 'delivered' ? new Date() : null,
    address: {
      fullName: 'Test buyer',
      phone: '9876543210',
      line1: 'Test road',
      city: 'Kochi',
      state: 'Kerala',
      pincode: '682001',
    },
    items: [
      {
        _id: '000000000000000000000002',
        product: '000000000000000000000003',
        name: 'Training shoes',
        slug: 'training-shoes',
        image: '/img/favicon.svg',
        price: 100000,
        mrp: 120000,
        quantity: 1,
        lineTotal: 100000,
        status,
      },
    ],
    subtotal: 100000,
    mrpTotal: 120000,
    discount: 20000,
    total: 100000,
    statusHistory: [{status: 'placed', at: new Date()}],
  });
}

async function serverFor(t, order) {
  t.mock.method(Order, 'findOne', async (filter) =>
    String(filter.user) === String(order.user) &&
    filter.orderId === order.orderId
      ? order
      : null,
  );
  t.mock.method(exchanges, 'choicesFor', async () => ({}));
  t.mock.method(orders, 'listOrders', async () => ({
    orders: [order.toObject()],
    filters: {status: 'all', period: 'all', q: '', page: 1},
    pagination: {page: 1, pages: 1, total: 1, limit: 10},
  }));
  const app = express();
  app.set('views', path.join(__dirname, '../views'));
  app.set('view engine', 'ejs');
  app.use(viewLocals, (req, res, next) => {
    req.user = {
      _id: order.user,
      name: 'Test buyer',
      email: 'buyer@example.test',
      role: 'customer',
      emailVerified: true,
    };
    res.locals.currentUser = req.user;
    res.locals.consent = false;
    res.locals.noindex = true;
    next();
  });
  app.use(require('../routes/pageRoutes'));
  app.use((error, req, res, _next) =>
    res.status(error.status || 500).send(error.message),
  );
  const server = await new Promise((resolve) => {
    const value = app.listen(0, '127.0.0.1', () => resolve(value));
  });
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return `http://127.0.0.1:${server.address().port}`;
}

test('complete customer order pages and partial navigation render the tracking helper correctly', async (t) => {
  const base = await serverFor(t, fixture());
  for (const url of [
    '/orders/NX-2026-100001',
    '/account/orders/NX-2026-100001',
  ]) {
    for (const partial of [false, true]) {
      const response = await fetch(base + url, {
        headers: partial ? {'X-Partial': '1'} : {},
      });
      const html = await response.text();
      assert.equal(response.status, 200, html);
      assert.match(html, /data-page="account-order"/);
      assert.match(html, /Paid on delivery/);
      assert.equal((html.match(/timeline-step is-done/g) || []).length, 5);
      assert.doesNotMatch(html, /timeText is not defined/);
      assert.equal(html.includes('<!doctype html>'), !partial);
    }
  }
});

test('wallet paid order cards show the full order value on both customer list URLs', async (t) => {
  const order = fixture();
  order.paymentMethod = 'wallet';
  order.walletUsed = 100000;
  order.total = 0;
  const base = await serverFor(t, order);
  for (const url of ['/orders', '/account/orders']) {
    const response = await fetch(base + url);
    const html = await response.text();
    assert.equal(response.status, 200, html);
    assert.match(html, /Order value<\/span><strong>₹1,000<\/strong>/);
    assert.match(html, /href="\/orders\/NX-2026-100001"/);
  }
});

test('customer order lookup remains scoped to the owner and rejects bad IDs', async (t) => {
  let lookup;
  t.mock.method(Order, 'findOne', async (filter) => {
    lookup = filter;
    return null;
  });
  await assert.rejects(orders.getOwnedOrder('buyer-a', 'NX-2026-100001'), {
    status: 404,
  });
  assert.deepEqual(lookup, {orderId: 'NX-2026-100001', user: 'buyer-a'});
  lookup = null;
  await assert.rejects(orders.getOwnedOrder('buyer-a', '../100001'), {
    status: 404,
  });
  assert.equal(lookup, null);
});

test('paid customer cancellations always reserve the refund for Nexthlon wallet', async (t) => {
  const order = fixture('placed');
  order.paymentMethod = 'razorpay';
  order.save = async () => order;
  t.mock.method(Order, 'findOne', async () => order);
  t.mock.method(
    require('../services/settlementService'),
    'resume',
    async () => order,
  );
  await orders.cancelOrder(order.user, order.orderId, {
    refundMethod: 'original',
  });
  assert.equal(order.orderStatus, 'cancelled');
  assert.equal(order.settlements.length, 1);
  assert.equal(order.settlements[0].method, 'wallet');
  assert.equal(order.settlements[0].refund, 100000);
});

test('customer item cancellations use wallet while shipped items cannot be cancelled', async (t) => {
  const order = fixture('placed');
  order.paymentMethod = 'razorpay';
  order.items.push({
    ...order.items[0].toObject(),
    _id: '000000000000000000000004',
    status: 'shipped',
  });
  order.subtotal = 200000;
  order.total = 200000;
  order.save = async () => order;
  t.mock.method(Order, 'findOne', async () => order);
  t.mock.method(
    require('../services/settlementService'),
    'resume',
    async () => order,
  );
  await orders.cancelItem(
    order.user,
    order.orderId,
    String(order.items[0]._id),
    {refundMethod: 'original'},
  );
  assert.equal(order.items[0].status, 'cancelled');
  assert.equal(order.items[1].status, 'shipped');
  assert.equal(order.settlements[0].method, 'wallet');
  order.settlements[0].done = true;
  await assert.rejects(
    orders.cancelItem(order.user, order.orderId, String(order.items[1]._id)),
    {status: 400},
  );
  assert.equal(order.settlements.length, 1);
});

test('paid cancellation policy and completed wallet credits are visible in the customer order', async (t) => {
  const order = fixture('cancelled');
  order.refunds.push({amount: 100000, method: 'wallet', status: 'processed'});
  const base = await serverFor(t, order);
  const response = await fetch(base + '/account/orders/' + order.orderId);
  const html = await response.text();
  assert.equal(response.status, 200, html);
  assert.match(html, /data-cancel-wallet-policy/);
  assert.match(html, /cannot be withdrawn to a bank or used on other websites/);
  assert.match(html, /credited to Nexthlon wallet/);
  assert.match(html, /href="\/account\/wallet">View wallet/);
  assert.doesNotMatch(html, /name="refundMethod"/);
});
