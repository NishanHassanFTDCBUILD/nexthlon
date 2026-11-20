// Product videos: an MP4 or WebM file the team uploads for a product. The file's real signature is checked (not
// just its name), it is kept in the same storage as the photos (local disk or the Cloudinary account), and the
// product's video link is set to where it was saved.
const crypto = require('crypto');
const storage = require('../providers/storage');
const {HttpError} = require('../utils/http');
const logger = require('../utils/logger');

const MAX_VIDEO_BYTES = 25 * 1024 * 1024;

// The first bytes of each format: MP4 has "ftyp" at byte 4; WebM starts with the EBML header.
function videoTypeOf(buffer) {
  if (!buffer || buffer.length < 12) return null;
  if (buffer.slice(4, 8).toString('ascii') === 'ftyp')
    return {ext: 'mp4', type: 'video/mp4'};
  if (
    buffer[0] === 0x1a &&
    buffer[1] === 0x45 &&
    buffer[2] === 0xdf &&
    buffer[3] === 0xa3
  )
    return {ext: 'webm', type: 'video/webm'};
  return null;
}

async function saveVideo(file) {
  if (!file || !file.buffer)
    throw new HttpError(400, 'Choose a video file to upload.', {
      video: 'Choose a video file to upload.',
    });
  if (file.size > MAX_VIDEO_BYTES || file.buffer.length > MAX_VIDEO_BYTES)
    throw new HttpError(
      400,
      'The video is larger than 25 MB. Make it shorter or smaller.',
      {video: 'The video is larger than 25 MB.'},
    );
  const kind = videoTypeOf(file.buffer);
  if (!kind)
    throw new HttpError(400, 'Upload an MP4 or WebM video.', {
      video: 'Upload an MP4 or WebM video.',
    });
  const key = `products/videos/${crypto.randomBytes(16).toString('hex')}.${kind.ext}`;
  const store = storage.current();
  try {
    await store.put(key, file.buffer, {contentType: kind.type});
  } catch (error) {
    logger.warn('video.save_failed', {message: error.message});
    throw new HttpError(500, 'The video could not be saved. Try again.');
  }
  return store.publicUrl(key);
}

module.exports = {saveVideo, videoTypeOf, MAX_VIDEO_BYTES};
