// POST /api/admin/products/:productId/video  (multipart, one file in "video"): uploads a product video (services/videoService.js).
const multer = require('multer');
const mongoose = require('mongoose');
const Product = require('../models/Product');
const storage = require('../providers/storage');
const videoService = require('../services/videoService');
const auditService = require('../services/auditService');
const {asyncHandler, HttpError} = require('../utils/http');

const parse = multer({
  storage: multer.memoryStorage(),
  limits: {fileSize: videoService.MAX_VIDEO_BYTES, files: 1, fields: 5},
}).single('video');

// A file too large (or any upload problem) becomes a plain message the team can act on.
function videoUpload(req, res, next) {
  parse(req, res, (error) => {
    if (!error) return next();
    const message =
      error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE'
        ? 'The video is larger than 25 MB. Make it shorter or smaller.'
        : 'That upload did not work. Try again with an MP4 or WebM video.';
    return next(new HttpError(400, message, {video: message}));
  });
}

const upload = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.productId))
    throw new HttpError(404, 'Product not found.');
  const product = await Product.findById(req.params.productId);
  if (!product) throw new HttpError(404, 'Product not found.');
  const previous = product.videoUrl || '';
  const url = await videoService.saveVideo(req.file);
  product.videoUrl = url;
  await product.save();
  // The replaced video is removed from storage, so nothing is left behind.
  if (previous) {
    const backend = storage.backendFor(previous);
    const key = backend ? backend.keyFromUrl(previous) : null;
    if (key && key.startsWith('products/videos/'))
      await backend.remove([key]).catch(() => {});
  }
  await auditService.record({
    ...auditService.fromRequest(req),
    action: 'product.video_uploaded',
    target: `product:${product._id}`,
    after: {videoUrl: url},
  });
  res.json({message: 'Video uploaded and set on this product.', videoUrl: url});
});

module.exports = {videoUpload, upload};
