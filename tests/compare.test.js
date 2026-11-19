// Compare: the selection is cleaned up before any database work, so this runs without MongoDB.
const test = require('node:test');
const assert = require('node:assert/strict');
const {parseSlugs, MAX_ITEMS} = require('../services/compareService');

test('compare: keeps unique, valid slugs in order, at most four', () => {
  assert.deepEqual(parseSlugs('a-shoe, b-racket,a-shoe,,c'), [
    'a-shoe',
    'b-racket',
    'c',
  ]);
  assert.deepEqual(parseSlugs('one,two,three,four,five,six'), [
    'one',
    'two',
    'three',
    'four',
  ]);
  assert.equal(MAX_ITEMS, 4);
});

test('compare: rejects anything that is not a slug', () => {
  assert.deepEqual(parseSlugs('<script>,../admin,good-one, Spaced Name'), [
    'good-one',
  ]);
  assert.deepEqual(parseSlugs(undefined), []);
  assert.deepEqual(parseSlugs(['x-1', 'x-2']), ['x-1', 'x-2']);
});
