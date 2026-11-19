// POST /api/admin/products/:productId/spin  (multipart, photos in "frames", in turning order): sets the product's
// 360 view from uploaded photos (services/spinFrameService.js). The frames it replaces are removed from storage.
const multer = require('multer');
const mongoose = require('mongoose');
const Product = require('../models/Product');
const auditService = require('../services/auditService');
const imageService = require('../services/imageService');
const spinFrameService = require('../services/spinFrameService');
const {asyncHandler, HttpError} = require('../utils/http');

const parse = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: imageService.MAX_IMAGE_BYTES,
    files: spinFrameService.MAX_FRAMES,
    fields: 5,
  },
}).array('frames', spinFrameService.MAX_FRAMES);

// A file too large, too many, or any upload problem becomes a plain message the team can act on.
function framesUpload(req, res, next) {
  parse(req, res, (error) => {
    if (!error) return next();
    const message =
      error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE'
        ? 'Each 360 photo must be 2 MB or smaller.'
        : error instanceof multer.MulterError &&
            error.code === 'LIMIT_FILE_COUNT'
          ? `Upload up to ${spinFrameService.MAX_FRAMES} photos for the 360 view.`
          : 'That upload did not work. Try again with JPG, PNG or WebP photos.';
    return next(new HttpError(400, message, {spin: message}));
  });
}

const upload = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.productId))
    throw new HttpError(404, 'Product not found.');
  const product = await Product.findById(req.params.productId);
  if (!product) throw new HttpError(404, 'Product not found.');
  const previous = product.spinFrames || [];
  const urls = await spinFrameService.saveFrames(req.files || []);
  product.spinFrames = urls;
  await product.save();
  await spinFrameService.deleteFrames(previous);
  await auditService.record({
    ...auditService.fromRequest(req),
    action: 'product.spin_uploaded',
    target: `product:${product._id}`,
    after: {frames: urls.length},
  });
  res.json({
    message: `360 view set with ${urls.length} photos.`,
    spinFrames: urls,
  });
});

module.exports = {framesUpload, upload};
