// Step 9: sales by category and state, for a period, paid orders only.
require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const {period, toCsv} = require('../services/salesBreakdownService');

test('period: defaults to the last 30 days in India time, and refuses a bad range', () => {
  const now = new Date('2026-11-19T10:00:00Z');
  const p = period({}, now);
  assert.equal(p.to, '2026-11-19');
  assert.equal(p.from, '2026-10-21');
  assert.throws(() => period({from: '2026-11-10', to: '2026-11-01'}, now));
  assert.throws(
    () => period({from: '2025-01-01', to: '2026-11-01'}, now),
    /one year/,
  );
});

test('CSV: categories then states, in rupees', () => {
  const csv = toCsv({
    categories: [{name: 'Running', units: 3, revenue: 150000}],
    states: [{name: 'Kerala', orders: 2, revenue: 99950}],
  });
  assert.match(csv, /"Running","3","1500\.00"/);
  assert.match(csv, /"Kerala","2","999\.50"/);
});

if (!process.env.TEST_MONGODB_URI) {
  test(
    'sales breakdown page (set TEST_MONGODB_URI to run it)',
    {skip: true},
    () => {},
  );
}
