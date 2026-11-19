// 360 spin frames: https image links only, 36 at most (no database).
const test = require('node:test');
const assert = require('node:assert/strict');
const {validateProduct} = require('../utils/validators');

const base = {
  name: 'Test racket',
  category: 'rackets',
  price: 1000,
  mrp: 1200,
  stock: 3,
};
const NEWLINE = String.fromCharCode(10);

test('360 spin: a list of https image links is accepted, one per line', () => {
  const frames = [
    'https://cdn.example.com/s-001.jpg',
    'https://cdn.example.com/s-002.webp',
  ];
  const {errors, value} = validateProduct({
    ...base,
    spinFrames: frames.join(NEWLINE),
  });
  assert.equal(errors.spinFrames, undefined);
  assert.deepEqual(value.spinFrames, frames);
});

test('360 spin: non-image links and more than 36 frames are refused', () => {
  assert.ok(
    validateProduct({...base, spinFrames: 'javascript:alert(1)'}).errors
      .spinFrames,
  );
  assert.ok(
    validateProduct({...base, spinFrames: 'https://cdn.example.com/a.mp4'})
      .errors.spinFrames,
  );
  const many = Array.from(
    {length: 37},
    (_, i) => `https://cdn.example.com/f-${i}.jpg`,
  );
  assert.ok(
    validateProduct({...base, spinFrames: many.join(NEWLINE)}).errors
      .spinFrames,
  );
});
