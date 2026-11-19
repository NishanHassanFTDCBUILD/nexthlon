// Spelling help for search (utils/fuzzy.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const {editDistance, correctQuery, vocabularyFrom} = require('../utils/fuzzy');

test('edit distance: one change, a swapped pair counts as one, and it gives up past the limit', () => {
  assert.equal(editDistance('shoes', 'shoes'), 0);
  assert.equal(editDistance('shoees', 'shoes'), 1);
  assert.equal(editDistance('shoe', 'shoes'), 1);
  assert.equal(editDistance('raket', 'racket'), 1);
  assert.equal(
    editDistance('tennsi', 'tennis'),
    1,
    'a swapped pair is one mistake',
  );
  assert.equal(editDistance('bottle', 'helmet', 2), 3, 'too far: max + 1');
});

test('vocabulary: lower-case words of 3+ letters from names, brands and categories, no numbers', () => {
  const words = vocabularyFrom([
    'Velocity Running Shoes',
    'NEXTHLON TRAIL LAB',
    '2-Person Tent',
    null,
  ]);
  assert.deepEqual(words.sort(), [
    'lab',
    'nexthlon',
    'person',
    'running',
    'shoes',
    'tent',
    'trail',
    'velocity',
  ]);
});

test("correct query: fixes misspelt words with the store's own words, keeps the rest", () => {
  const vocab = vocabularyFrom([
    'Velocity Running Shoes',
    'Precision Tennis Racket',
    'Adidas',
    'Football Training Jersey',
    'Aqua Training Goggles',
  ]);
  assert.equal(correctQuery('shoees', vocab), 'shoes');
  assert.equal(correctQuery('runing shoes', vocab), 'running shoes');
  assert.equal(correctQuery('tennsi raket', vocab), 'tennis racket');
  assert.equal(correctQuery('addidas', vocab), 'adidas');
  assert.equal(correctQuery('goggels', vocab), 'goggles');
  assert.equal(correctQuery('shoes', vocab), null, 'nothing to fix');
  assert.equal(
    correctQuery('bat', vocab),
    null,
    'short words are never changed (they would match too much)',
  );
  assert.equal(
    correctQuery('xyzzyq', vocab),
    null,
    'no close word: kept as typed',
  );
  assert.equal(correctQuery('size 42', vocab), null, 'numbers are kept');
});
