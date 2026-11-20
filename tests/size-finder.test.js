// Find my size: the chart lookup (no database).
const test = require('node:test');
const assert = require('node:assert/strict');
const {sizeFor} = require('../services/sizeFinderService');

test('size finder: a foot length gives its EU, UK and US size', () => {
  assert.deepEqual(sizeFor('25.3'), {footCm: 25.3, eu: 40, uk: 7, us: 8});
  assert.deepEqual(sizeFor('25,3'), {footCm: 25.3, eu: 40, uk: 7, us: 8});
  assert.equal(sizeFor('28').eu, 44);
});

test('size finder: lengths outside the chart are refused with a clear message', () => {
  assert.throws(
    () => sizeFor('15'),
    (e) => e.status === 400 && /between 22 and 30/.test(e.message),
  );
  assert.throws(
    () => sizeFor('abc'),
    (e) => e.status === 400,
  );
  assert.throws(
    () => sizeFor(''),
    (e) => e.status === 400,
  );
});
