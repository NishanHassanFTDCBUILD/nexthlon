// Product video uploads: the file's real signature decides, and oversized or wrong files are refused before anything
// is stored (no database and no files written).
// Test settings (no .env needed, as in CI).
require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  videoTypeOf,
  saveVideo,
  MAX_VIDEO_BYTES,
} = require('../services/videoService');

test('video upload: MP4 and WebM are recognised by their real signature, anything else is not', () => {
  const mp4 = Buffer.concat([
    Buffer.from([0, 0, 0, 24]),
    Buffer.from('ftypisom'),
    Buffer.alloc(8),
  ]);
  assert.deepEqual(videoTypeOf(mp4), {ext: 'mp4', type: 'video/mp4'});
  const webm = Buffer.concat([
    Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
    Buffer.alloc(12),
  ]);
  assert.deepEqual(videoTypeOf(webm), {ext: 'webm', type: 'video/webm'});
  assert.equal(
    videoTypeOf(Buffer.from('<html>not a video at all</html>')),
    null,
  );
  assert.equal(videoTypeOf(Buffer.from('short')), null);
});

test('video upload: a file over 25 MB is refused with a message the team can act on', async () => {
  const big = {buffer: Buffer.alloc(8), size: MAX_VIDEO_BYTES + 1};
  const error = await saveVideo(big).catch((e) => e);
  assert.equal(error.status, 400);
  assert.match(error.message, /larger than 25 MB/);
});

test('video upload: a file that is not an MP4 or WebM is refused before storage', async () => {
  const fake = {
    buffer: Buffer.from('<script>alert(1)</script>'.padEnd(64, ' ')),
    size: 64,
  };
  const error = await saveVideo(fake).catch((e) => e);
  assert.equal(error.status, 400);
  assert.match(error.message, /MP4 or WebM/);
});

test('video upload: no file is refused', async () => {
  const error = await saveVideo(undefined).catch((e) => e);
  assert.equal(error.status, 400);
});
