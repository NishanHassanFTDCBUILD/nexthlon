require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const ejs = require('ejs');
const orders = require('../services/orderService');
const admin = require('../services/adminOrderService');
const shipping = require('../services/shippingService');
const rules = require('../utils/orderRules');
const Order = require('../models/Order');
const events = require('../events');
const referrals = require('../services/referralService');

const placedAt = new Date('2026-11-18T09:14:00Z');
const deliveredAt = new Date('2026-11-21T10:24:00Z');
function fixture(status = 'placed', paymentMethod = 'cod') {
  return {
    orderId: 'NX-2026-100001',
    user: '000000000000000000000001',
    orderStatus: status,
    paymentMethod,
    paymentStatus: paymentMethod === 'cod' ? 'pending' : 'paid',
    createdAt: placedAt,
    deliveredAt: null,
    items: [{status}, {status: 'cancelled'}],
    statusHistory: [{status: 'placed', at: placedAt}],
    settlements: [],
    save: async () => {},
  };
}

test('every forward admin transition completes tracking through the selected milestone', async (t) => {
  t.mock.method(events, 'emit', async () => {});
  t.mock.method(referrals, 'rewardOnDelivery', async () => {});
  for (const [index, current] of rules.FLOW.entries()) {
    for (const next of rules.FLOW.slice(index + 1)) {
      const order = fixture(current);
      order.statusHistory.push({status: current, at: placedAt});
      await orders.advanceStatus(order, next, 'admin', deliveredAt);
      assert.equal(order.orderStatus, next);
      assert.equal(order.items[0].status, next);
      assert.equal(order.items[1].status, 'cancelled');
      const timeline = orders.timelineFor(order);
      assert.deepEqual(
        timeline.map((step) => step.done),
        rules.FLOW.map((_, i) => i <= rules.FLOW.indexOf(next)),
      );
      assert.equal(timeline[rules.FLOW.indexOf(next)].at, deliveredAt);
      assert.equal(
        order.paymentStatus,
        next === 'delivered' ? 'paid' : 'pending',
      );
      // Only the actual change is audited; skipped milestones get no fictional time.
      assert.equal(order.statusHistory.length, 3);
      assert.equal(order.statusHistory.at(-1).status, next);
    }
  }
});

test('admin Delivered fixes the customer tracker without inventing earlier timestamps', async (t) => {
  const order = fixture();
  t.mock.method(Order, 'findOne', async () => order);
  t.mock.method(events, 'emit', async () => {});
  t.mock.method(referrals, 'rewardOnDelivery', async () => {});
  await admin.updateStatus(order.orderId, 'delivered');
  const timeline = orders.timelineFor(order);
  assert.ok(timeline.every((step) => step.done));
  assert.deepEqual(
    timeline.slice(1, 4).map((step) => step.at),
    [null, null, null],
  );
  assert.equal(order.statusHistory.length, 2);
  const html = await ejs.renderFile(
    path.join(__dirname, '../views/partials/order-timeline.ejs'),
    {
      order,
      timeline,
      icon: () => '<svg></svg>',
      timeText: (at) => new Date(at).toISOString(),
    },
  );
  assert.doesNotMatch(html, /Pending/);
  assert.equal((html.match(/is-done/g) || []).length, 5);
  assert.equal((html.match(/Completed/g) || []).length, 3);
  assert.match(html, /aria-current="step"/);
});

test('existing sparse histories, returns and cancellations render truthful progress', () => {
  const delivered = fixture('delivered');
  delivered.deliveredAt = deliveredAt;
  assert.ok(orders.timelineFor(delivered).every((step) => step.done));
  assert.equal(orders.timelineFor(delivered)[4].at, deliveredAt);
  const shipped = fixture('shipped');
  assert.deepEqual(
    orders.timelineFor(shipped).map((step) => step.done),
    [true, true, true, false, false],
  );
  const cancelled = fixture('cancelled');
  cancelled.statusHistory.push(
    {status: 'confirmed', at: deliveredAt},
    {status: 'cancelled', at: deliveredAt},
  );
  assert.deepEqual(
    orders.timelineFor(cancelled).map((step) => step.status),
    ['placed', 'confirmed', 'cancelled'],
  );
  const returned = fixture('returned');
  assert.ok(orders.timelineFor(returned).every((step) => step.done));
  const requested = fixture('return_requested');
  assert.deepEqual(
    orders.timelineFor(requested).map((step) => step.done),
    [true, true, true, true, true, true, false],
  );
  delete shipped.statusHistory;
  assert.equal(orders.timelineFor(shipped)[0].at, placedAt);
});

test('backward and terminal changes remain blocked without saving or changing payment', async (t) => {
  t.mock.method(events, 'emit', async () => {});
  for (const status of [
    'shipped',
    'delivered',
    'cancelled',
    'returned',
    'return_requested',
  ]) {
    const order = fixture(status);
    let saves = 0;
    order.save = async () => {
      saves++;
    };
    await assert.rejects(orders.advanceStatus(order, 'confirmed'), {
      status: 400,
    });
    assert.equal(order.orderStatus, status);
    assert.equal(order.paymentStatus, 'pending');
    assert.equal(saves, 0);
  }
  const unsettled = fixture();
  unsettled.settlements = [{done: false}];
  await assert.rejects(orders.advanceStatus(unsettled, 'delivered'), {
    status: 409,
  });
  assert.equal(unsettled.orderStatus, 'placed');
});

test('courier delivery jumps use the same customer progress and ignore a subsequent older status', async (t) => {
  const order = fixture('confirmed');
  order.shipments = [{trackingNumber: 'AWB123', events: []}];
  t.mock.method(Order, 'findOne', async () => order);
  t.mock.method(events, 'emit', async () => {});
  t.mock.method(referrals, 'rewardOnDelivery', async () => {});
  const result = await shipping.handleTrackingUpdate({
    awb: 'AWB123',
    current_status: 'DELIVERED',
    current_timestamp: deliveredAt.toISOString(),
  });
  assert.equal(result.moved, 'delivered');
  assert.ok(orders.timelineFor(order).every((step) => step.done));
  assert.equal(order.paymentStatus, 'paid');
  const older = await shipping.handleTrackingUpdate({
    awb: 'AWB123',
    current_status: 'IN TRANSIT',
    current_timestamp: placedAt.toISOString(),
  });
  assert.equal(older.moved, null);
  assert.equal(order.orderStatus, 'delivered');
});
