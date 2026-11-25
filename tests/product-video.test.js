// Product video links: only https MP4 or WebM addresses are accepted (no database).
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

test('uploaded local product media survives subsequent product edits', () => {
  const videoUrl = '/uploads/products/videos/demo.mp4';
  const {errors, value} = validateProduct({...base, videoUrl});
  assert.equal(errors.videoUrl, undefined);
  assert.equal(value.videoUrl, videoUrl);
});

test('product video: an https MP4 or WebM link is accepted, with or without a query', () => {
  for (const videoUrl of [
    'https://cdn.example.com/shoe-spin.mp4',
    'https://cdn.example.com/shoe.webm?v=2',
  ]) {
    const {errors, value} = validateProduct({...base, videoUrl});
    assert.equal(errors.videoUrl, undefined, videoUrl);
    assert.equal(value.videoUrl, videoUrl);
  }
});

test('product video: other schemes, hosts and file types are refused', () => {
  for (const videoUrl of [
    'javascript:alert(1)',
    'http://cdn.example.com/a.mp4',
    'https://cdn.example.com/a.mp4 extra',
    'https://cdn.example.com/page.html',
  ]) {
    const {errors} = validateProduct({...base, videoUrl});
    assert.ok(errors.videoUrl, videoUrl);
  }
});
