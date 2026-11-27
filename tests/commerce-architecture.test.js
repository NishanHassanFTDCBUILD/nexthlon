require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const ejs = require('ejs');
const {orderExperience} = require('../utils/orderExperience');
const orders = require('../services/orderService');
const Order = require('../models/Order');
const {navFor} = require('../config/adminNav');
const {ACCOUNT_NAV} = require('../config/accountNav');
const {viewLocals} = require('../middleware/viewLocals');

function fixture() {
  return {
    orderId: 'NX-2026-100001',
    paymentMethod: 'razorpay',
    paymentStatus: 'paid',
    orderStatus: 'delivered',
    total: 80000,
    walletUsed: 20000,
    refundedAmount: 30000,
    deliveredAt: new Date('2026-11-20T10:00:00Z'),
    items: [{_id: 'a', status: 'delivered'}],
    refunds: [
      {amount: 10000, status: 'processed'},
      {amount: 20000, status: 'pending'},
    ],
    statusHistory: [],
    settlements: [],
    save: async () => {},
  };
}
test('payment, delivery and refund projections stay separate without mutating stored state', () => {
  const order = fixture();
  const before = JSON.stringify(order);
  const state = orderExperience(order, new Date('2026-11-21T10:00:00Z'));
  assert.equal(state.value, 100000);
  assert.equal(state.payment.received, 100000);
  assert.equal(state.fulfillment.status, 'delivered');
  assert.deepEqual(state.refund, {
    processed: 10000,
    pending: 20000,
    failed: 0,
    reserved: 30000,
    available: 70000,
  });
  assert.equal(state.actions.return, true);
  assert.equal(JSON.stringify(order), before);
});
test('unpaid online orders cannot advance fulfillment even with a direct admin service call', async () => {
  const order = fixture();
  order.paymentStatus = 'pending';
  order.orderStatus = 'placed';
  order.items[0].status = 'placed';
  assert.equal(orderExperience(order).actions.advanceFulfillment, false);
  await assert.rejects(orders.advanceStatus(order, 'delivered'), {status: 409});
  assert.equal(order.orderStatus, 'placed');
  assert.equal(order.items[0].status, 'placed');
});
test('unfinished operations and size exchanges block conflicting customer actions', async (t) => {
  const order = fixture();
  order.items[0].exchange = {status: 'approved'};
  t.mock.method(Order, 'findOne', async () => order);
  assert.equal(orderExperience(order).actions.return, false);
  await assert.rejects(
    orders.requestReturn('buyer', order.orderId, {reason: 'Wrong size or fit'}),
    {status: 409},
  );
  delete order.items[0].exchange;
  order.settlements = [{done: false}];
  assert.equal(orderExperience(order).processing, true);
  assert.equal(orderExperience(order).actions.return, false);
  await assert.rejects(
    orders.requestReturn('buyer', order.orderId, {reason: 'Wrong size or fit'}),
    {status: 409},
  );
});
test('a new return request clears the previous decision and leaves its history intact', async (t) => {
  const order = fixture();
  order.deliveredAt = new Date();
  order.returnDecision = {status: 'rejected'};
  order.statusHistory = [{status: 'return_rejected', note: 'Earlier decision'}];
  t.mock.method(Order, 'findOne', async () => order);
  t.mock.method(require('../events'), 'emit', async () => {});
  await orders.requestReturn('buyer', order.orderId, {
    reason: 'Wrong size or fit',
    note: '',
  });
  assert.equal(order.returnDecision, null);
  assert.equal(order.statusHistory[0].note, 'Earlier decision');
  assert.equal(order.orderStatus, 'return_requested');
});
test('account hub and sidebar use one directory; financial workspaces respect roles', () => {
  const items = ACCOUNT_NAV.flatMap((g) => g.items);
  assert.equal(new Set(items.map((i) => i.key)).size, items.length);
  assert.ok(items.every((i) => i.description && i.href.startsWith('/account')));
  assert.ok(
    !navFor('packing')
      .flatMap((g) => g.items)
      .some((i) => i.key === 'transactions'),
  );
  assert.ok(
    navFor('finance')
      .flatMap((g) => g.items)
      .some((i) => i.key === 'transactions'),
  );
});
test('the complete account hub renders its service links in full and partial responses', async () => {
  const locals = {};
  viewLocals({path: '/account', query: {}}, {locals}, () => {});
  Object.assign(locals, {
    title: 'Your account',
    currentUser: {
      name: 'Test Buyer',
      email: 'buyer@example.test',
      createdAt: new Date(),
      emailVerified: true,
    },
    stats: {orders: 1, openOrders: 0, wallet: 0, wishlist: 0, coupons: 0},
    loyalty: {name: 'Member'},
    lastOrder: {...fixture(), createdAt: new Date()},
    recent: [],
    recommended: [],
    labels: {delivered: 'Delivered'},
    consent: false,
  });
  for (const partial of [false, true]) {
    const html = await ejs.renderFile(
      path.join(__dirname, '../views/account/overview.ejs'),
      {...locals, partial},
    );
    assert.equal(
      (html.match(/class="commerce-service-card"/g) || []).length,
      require('../config/accountNav')
        .ACCOUNT_NAV.flatMap((group) => group.items)
        .filter((item) => item.key !== 'overview').length,
    );
    assert.match(html, /Everything in one place/);
    assert.match(html, /href="\/account\/security"/);
  }
});
