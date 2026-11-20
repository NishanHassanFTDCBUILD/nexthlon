// 360 spin frames: the photos of one product turned a little at a time. Each frame is checked by its real
// image type (not its name), turned the right way up, camera details removed, and saved as one WebP file
// at most 900px on its longest side. Frames live in the same storage as the product photos.
const crypto = require('crypto');
const storage = require('../providers/storage');
const imageService = require('./imageService');
const {HttpError} = require('../utils/http');
const logger = require('../utils/logger');

const MIN_FRAMES = 3;
const MAX_FRAMES = 36;
const FRAME_SIDE = 900;
const FRAME_FOLDER = 'products/spin/';
const MAX_PIXELS = 64_000_000;
const WEBP = {quality: 80, effort: 4};

// Checks every file is a real JPG, PNG or WEBP and the count is in range. Throws a message the team can act on.
function checkFrames(files = []) {
  if (files.length < MIN_FRAMES)
    throw new HttpError(
      400,
      `Upload at least ${MIN_FRAMES} photos for the 360 view.`,
      {spin: `Upload at least ${MIN_FRAMES} photos for the 360 view.`},
    );
  if (files.length > MAX_FRAMES)
    throw new HttpError(
      400,
      `Upload up to ${MAX_FRAMES} photos for the 360 view.`,
      {spin: `Upload up to ${MAX_FRAMES} photos for the 360 view.`},
    );
  const fake = imageService.findFakeImages(files);
  if (fake.length) {
    const message = `These are not JPG, PNG or WebP photos: ${fake.join(', ')}.`;
    throw new HttpError(400, message, {spin: message});
  }
  const large = files.filter(
    (file) => file.size > imageService.MAX_IMAGE_BYTES,
  );
  if (large.length) {
    const message = 'Each 360 photo must be 2 MB or smaller.';
    throw new HttpError(400, message, {spin: message});
  }
}

// Saves the frames in the order given and returns their public addresses in that same order.
// If anything fails part-way, what was already written is removed again.
async function saveFrames(files = []) {
  checkFrames(files);
  const sharp = require('sharp');
  const store = storage.current();
  const written = [];
  try {
    const bodies = await Promise.all(
      files.map(async (file) => {
        try {
          return await sharp(file.buffer, {
            failOn: 'none',
            limitInputPixels: MAX_PIXELS,
          })
            .rotate()
            .resize({
              width: FRAME_SIDE,
              height: FRAME_SIDE,
              fit: 'inside',
              withoutEnlargement: true,
            })
            .webp(WEBP)
            .toBuffer();
        } catch (error) {
          logger.warn('spin.render_failed', {error});
          const message =
            'One of the 360 photos could not be processed. Try a different file.';
          throw new HttpError(400, message, {spin: message});
        }
      }),
    );
    const keys = bodies.map(
      () => `${FRAME_FOLDER}${crypto.randomBytes(16).toString('hex')}.webp`,
    );
    written.push(...keys);
    await Promise.all(
      bodies.map((body, index) =>
        store.put(keys[index], body, {contentType: 'image/webp'}),
      ),
    );
    return keys.map((key) => store.publicUrl(key));
  } catch (error) {
    await store.remove(written).catch(() => {});
    throw error;
  }
}

// Removes the frames of a product that were uploaded here (our own keys only). Never throws.
async function deleteFrames(urls = []) {
  const byBackend = new Map();
  for (const url of urls) {
    const backend = storage.backendFor(url);
    const key = backend ? backend.keyFromUrl(url) : null;
    if (!key || !key.startsWith(FRAME_FOLDER)) continue;
    byBackend.set(backend, [...(byBackend.get(backend) || []), key]);
  }
  await Promise.all(
    [...byBackend].map(([backend, keys]) =>
      backend
        .remove(keys)
        .catch((error) => logger.warn('storage.delete_failed', {error})),
    ),
  );
}

module.exports = {
  MIN_FRAMES,
  MAX_FRAMES,
  checkFrames,
  saveFrames,
  deleteFrames,
};
