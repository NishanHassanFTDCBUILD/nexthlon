require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const orders = require('../services/adminOrderService');
const Order = require('../models/Order');
const events = require('../events');

function orderFixture() {
  return {
    _id: '000000000000000000000001',
    orderId: 'NX-2026-100001',
    orderStatus: 'return_requested',
    paymentStatus: 'paid',
    settlements: [],
    statusHistory: [],
    subtotal: 100000,
    couponDiscount: 10000,
    deliveryFee: 4000,
    total: 94000,
    items: [
      {
        _id: '000000000000000000000002',
        name: 'Trail shoes',
        quantity: 1,
        price: 60000,
        lineTotal: 60000,
        status: 'return_requested',
      },
      {
        _id: '000000000000000000000003',
        name: 'Training top',
        quantity: 1,
        price: 40000,
        lineTotal: 40000,
        status: 'delivered',
      },
    ],
    address: {fullName: 'Test buyer', city: 'Kochi'},
    save: async () => {},
  };
}

test('rejecting a return keeps its original items and discounted request value', async (t) => {
  const order = orderFixture();
  t.mock.method(Order, 'findOne', async () => order);
  t.mock.method(events, 'emit', async () => {});
  await orders.decideReturn(
    order.orderId,
    {decision: 'reject', note: 'Outside the return policy.'},
    {_id: '000000000000000000000009'},
  );
  assert.equal(order.items[0].status, 'delivered');
  assert.deepEqual(order.returnDecision.itemIds, [order.items[0]._id]);
  assert.equal(order.returnDecision.requestedValue, 54000);
});

test('return list keeps rejected items visible and values pending returns after coupon discounts', async (t) => {
  const rejected = orderFixture();
  rejected.items[0].status = 'delivered';
  rejected.returnDecision = {
    status: 'rejected',
    itemIds: [rejected.items[0]._id],
    requestedValue: 54000,
  };
  rejected.orderStatus = 'delivered';
  const pending = orderFixture();
  let fields;
  const chain = {
    sort: () => chain,
    skip: () => chain,
    limit: () => chain,
    select: (value) => {
      fields = value;
      return chain;
    },
    lean: async () => [rejected, pending],
  };
  t.mock.method(Order, 'find', () => chain);
  t.mock.method(Order, 'countDocuments', async () => 2);
  const result = await orders.listReturns({status: 'all'});
  assert.equal(result.returns[0].items.length, 1);
  assert.match(result.returns[0].items[0], /^Trail shoes .*1$/);
  assert.equal(result.returns[0].value, 54000);
  assert.equal(result.returns[1].value, 54000);
  assert.match(fields, /subtotal couponDiscount prepaidDiscount deliveryFee/);
});

test('order filters reject impossible calendar days', () => {
  assert.equal(orders.readOrderFilters({from: '2026-02-30'}).from, '');
  assert.equal(
    orders.readOrderFilters({from: '2028-02-29'}).from,
    '2028-02-29',
  );
});

function browser() {
  const pages = {};
  const listeners = {};
  const notices = [];
  const Nx = {
    toast: (message) => notices.push(message),
    formValues: () => ({}),
    submitForm: async () => ({message: 'Saved'}),
    confirm: async () => true,
  };
  const root = {
    querySelector: (selector) =>
      selector === '[data-admin-order]'
        ? {dataset: {adminOrder: 'NX-2026-100001'}}
        : null,
    addEventListener: (event, fn) => (listeners[event] = fn),
  };
  vm.runInNewContext(
    fs.readFileSync(
      path.join(__dirname, '../public/js/admin-orders.js'),
      'utf8',
    ),
    {
      window: {
        NxPages: {define: (key, fn) => (pages[key] = fn)},
        NxNav: {reload: async () => {}},
      },
      document: {body: {dataset: {adminPath: '/admin'}}, addEventListener() {}},
      location: {hash: ''},
      Nx,
    },
  );
  pages['admin-order'](root, {aborted: false});
  return {Nx, notices, submit: listeners.submit};
}

test('Cancel selected cannot cancel anything when no items are selected', () => {
  const {Nx, notices, submit} = browser();
  let confirms = 0;
  Nx.confirm = async () => {
    confirms++;
    return true;
  };
  submit({
    preventDefault() {},
    target: {
      matches: (value) => value === '[data-cancel-form]',
      querySelectorAll: () => [],
    },
  });
  assert.equal(confirms, 0);
  assert.match(notices[0], /Select the items/);
});

test('an implicit return submission cannot default to approving a refund', () => {
  const {notices, submit} = browser();
  submit({
    preventDefault() {},
    target: {matches: (value) => value === '[data-return-form]'},
  });
  assert.match(notices[0], /Approve or Reject/);
});

test('double submission opens one confirmation and sends one order mutation', async () => {
  const {Nx, submit} = browser();
  let confirm;
  let requests = 0;
  Nx.confirm = () => new Promise((resolve) => (confirm = resolve));
  Nx.submitForm = async () => {
    requests++;
    return {message: 'Saved'};
  };
  const form = {
    matches: (value) => value === '[data-status-form]',
    elements: {
      status: {
        value: 'confirmed',
        selectedIndex: 0,
        options: [{textContent: 'Confirmed'}],
      },
    },
  };
  submit({target: form, preventDefault() {}});
  submit({target: form, preventDefault() {}});
  confirm(true);
  await new Promise(setImmediate);
  assert.equal(requests, 1);
});
