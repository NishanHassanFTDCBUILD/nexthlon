require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const coupons = require('../services/adminCouponService');
const ledger = require('../services/ledgerService');
const Order = require('../models/Order');
const {validateCoupon} = require('../utils/validators');

const valid = {
  code: 'RUN10',
  type: 'percent',
  value: '10',
  isActive: true,
  startsAt: '2026-11-21',
  endsAt: '2026-11-30',
  perUserLimit: '1',
};

test('coupon editing preserves the Indian start and expiry dates through repeated saves', () => {
  const first = validateCoupon(valid);
  assert.deepEqual(first.errors, {});
  assert.equal(first.value.startsAt.toISOString(), '2026-11-20T18:30:00.000Z');
  const form = coupons.toAdminCoupon({...first.value, _id: 'id'});
  assert.equal(form.startsDay, valid.startsAt);
  assert.equal(form.endsDay, valid.endsAt);
  const saved = validateCoupon({
    ...valid,
    startsAt: form.startsDay,
    endsAt: form.endsDay,
  });
  assert.equal(saved.value.startsAt.getTime(), first.value.startsAt.getTime());
  assert.equal(saved.value.endsAt.getTime(), first.value.endsAt.getTime());
});

test('coupon dates reject calendar overflow and accept a leap day', () => {
  for (const day of ['2026-02-29', '2026-02-30', '2026-04-31', '2026-13-01']) {
    assert.ok(validateCoupon({...valid, startsAt: day}).errors.startsAt, day);
    assert.ok(validateCoupon({...valid, endsAt: day}).errors.endsAt, day);
  }
  assert.deepEqual(
    validateCoupon({...valid, startsAt: '2028-02-29', endsAt: '2028-02-29'})
      .errors,
    {},
  );
});

test('fully used coupons belong to the used-up filter only while their dates are running', () => {
  const now = new Date('2026-11-21T06:00:00Z');
  const used = {isActive: true, usageLimit: 2, usedCount: 2};
  assert.equal(coupons.statusOf(used, now), 'used_up');
  assert.equal(
    coupons.statusOf({...used, startsAt: new Date('2026-12-01')}, now),
    'scheduled',
  );
  assert.equal(
    coupons.statusOf({...used, endsAt: new Date('2026-11-01')}, now),
    'expired',
  );
  const filter = coupons.statusFilter('used_up', now);
  assert.deepEqual(filter.$and, [
    {$or: [{startsAt: null}, {startsAt: {$lte: now}}]},
    {$or: [{endsAt: null}, {endsAt: {$gte: now}}]},
  ]);
});

test('ledger date filters do not roll impossible dates into the next month', () => {
  assert.equal(ledger.readFilters({from: '2026-02-30'}).from, '');
  assert.equal(ledger.readFilters({to: '2026-13-01'}).to, '');
  assert.equal(ledger.readFilters({from: '2028-02-29'}).from, '2028-02-29');
});

test('pending and failed refunds do not reduce received money in the ledger', async (t) => {
  let pipeline;
  t.mock.method(Order, 'aggregate', async (stages) => {
    pipeline = stages;
    return [{rows: [], totals: [], count: []}];
  });
  await ledger.listTransactions({type: 'refund'});
  const refund = pipeline.find(
    (stage) => stage.$project?.type?.$literal === 'refund',
  ).$project;
  assert.deepEqual(refund.direction, {
    $cond: [{$eq: ['$refunds.status', 'processed']}, 'out', 'none'],
  });
});

test('refund totals retain all statuses while rows and pagination follow the selected status', async (t) => {
  let pipeline;
  t.mock.method(Order, 'aggregate', async (stages) => {
    pipeline = stages;
    return [
      {
        rows: [],
        count: [{n: 3}],
        byStatus: [
          {_id: 'pending', amount: 30000, count: 3},
          {_id: 'processed', amount: 10000, count: 1},
        ],
      },
    ];
  });
  const result = await ledger.listRefunds({
    status: 'pending',
    method: 'wallet',
  });
  const match = pipeline.find(
    (stage) => stage.$match?.type === 'refund',
  ).$match;
  assert.equal(match.method, 'wallet');
  assert.equal(match.status, undefined);
  const facet = pipeline.find((stage) => stage.$facet).$facet;
  assert.deepEqual(facet.rows[0], {$match: {status: 'pending'}});
  assert.deepEqual(facet.count[0], {$match: {status: 'pending'}});
  assert.equal(result.byStatus.processed.amount, 10000);
  assert.equal(result.pagination.total, 3);
  assert.equal(
    result.chips.some((chip) => chip.key === 'type'),
    false,
  );
});

test('refund-only filters discard transaction statuses without leaving a misleading chip', async (t) => {
  t.mock.method(Order, 'aggregate', async () => [
    {rows: [], count: [], byStatus: []},
  ]);
  const result = await ledger.listRefunds({status: 'captured'});
  assert.equal(result.filters.status, 'all');
  assert.equal(
    result.chips.some((chip) => chip.key === 'status'),
    false,
  );
});
