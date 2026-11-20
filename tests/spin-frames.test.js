// 360 frame uploads: the count is checked, every frame must be a real JPG, PNG or WebP, and each is size-limited.
// These checks run before anything is stored, so no database or storage is needed.
// Test settings (no .env needed, as in CI).
require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const {
  checkFrames,
  MIN_FRAMES,
  MAX_FRAMES,
} = require('../services/spinFrameService');
const {MAX_IMAGE_BYTES} = require('../services/imageService');

async function realPng() {
  return sharp({
    create: {width: 40, height: 40, channels: 3, background: '#d4ff3a'},
  })
    .png()
    .toBuffer();
}

function asFile(buffer, name = 'frame.png') {
  return {buffer, size: buffer.length, originalname: name};
}

test('360 frames: a real photo set is accepted, in its order', async () => {
  const png = await realPng();
  const files = Array.from({length: MIN_FRAMES}, (_, i) =>
    asFile(png, `shoe-${i}.png`),
  );
  assert.doesNotThrow(() => checkFrames(files));
});

test('360 frames: too few or too many photos is refused with a clear message', async () => {
  const png = await realPng();
  const few = [asFile(png)];
  assert.throws(
    () => checkFrames(few),
    (error) => {
      assert.equal(error.status, 400);
      assert.match(error.message, new RegExp(`at least ${MIN_FRAMES}`));
      return true;
    },
  );
  const many = Array.from({length: MAX_FRAMES + 1}, () => asFile(png));
  assert.throws(
    () => checkFrames(many),
    (error) => {
      assert.equal(error.status, 400);
      assert.match(error.message, new RegExp(`up to ${MAX_FRAMES}`));
      return true;
    },
  );
});

test('360 frames: a file that is not a real image is refused and named', async () => {
  const png = await realPng();
  const files = [
    asFile(png),
    asFile(Buffer.from('<html>not a photo, just text here</html>'), 'evil.png'),
    asFile(png),
  ];
  assert.throws(
    () => checkFrames(files),
    (error) => {
      assert.equal(error.status, 400);
      assert.match(error.message, /evil\.png/);
      return true;
    },
  );
});

test('360 frames: a frame over the size limit is refused', async () => {
  const png = await realPng();
  const huge = {
    buffer: png,
    size: MAX_IMAGE_BYTES + 1,
    originalname: 'big.png',
  };
  const files = [asFile(png), asFile(png), huge];
  assert.throws(
    () => checkFrames(files),
    (error) => {
      assert.equal(error.status, 400);
      assert.match(error.message, /2 MB or smaller/);
      return true;
    },
  );
});
