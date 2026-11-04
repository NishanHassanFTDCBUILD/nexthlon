const multer = require("multer");
const { HttpError } = require("../utils/http");
const { MAX_IMAGES, MAX_IMAGE_BYTES, ALLOWED_TYPES } = require("../services/imageService");

// Files are held in memory first, so their real type can be checked before anything touches the disk.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: MAX_IMAGES, fields: 20, fieldSize: 16 * 1024, parts: 30 },
  // A first, quick check on what the browser says. imageService checks the file's bytes as well.
  fileFilter(req, file, done) {
    if (ALLOWED_TYPES.has(file.mimetype) && /\.(jpe?g|png|webp)$/i.test(file.originalname)) return done(null, true);
    return done(new HttpError(400, "Only JPG, PNG or WEBP images can be uploaded.", {
      images: "Only JPG, PNG or WEBP images can be uploaded."
    }));
  }
});

const MULTER_MESSAGES = {
  LIMIT_FILE_SIZE: "Each image must be 2 MB or smaller.",
  LIMIT_FILE_COUNT: `You can upload up to ${MAX_IMAGES} images.`,
  LIMIT_UNEXPECTED_FILE: `You can upload up to ${MAX_IMAGES} images.`
};

// Reads a multipart form with up to MAX_IMAGES files in the "images" field.
// Upload problems become normal 400 errors with a message under the images field.
function productImages(req, res, next) {
  upload.array("images", MAX_IMAGES)(req, res, error => {
    if (!error) return next();
    if (error instanceof HttpError) return next(error);
    if (error instanceof multer.MulterError) {
      const message = MULTER_MESSAGES[error.code] || "The upload could not be read. Please try again.";
      return next(new HttpError(400, message, { images: message }));
    }
    return next(error);
  });
}

module.exports = { productImages };
