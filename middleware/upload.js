const multer = require('multer');
const {HttpError} = require('../utils/http');
const {
  MAX_IMAGES,
  MAX_RETURN_PHOTOS,
  MAX_IMAGE_BYTES,
  ALLOWED_TYPES,
} = require('../services/imageService');

// Files are held in memory first, so their real type can be checked before anything touches the disk.
const upload = multer({
  storage: multer.memoryStorage(),
  // The product form sends about 21 text fields with the photos (details, sizes, photo order, colours),
  // so the field and part limits leave room for it. Files are still limited by MAX_IMAGES and size.
  limits: {
    fileSize: MAX_IMAGE_BYTES,
    files: MAX_IMAGES,
    fields: 40,
    fieldSize: 64 * 1024,
    parts: 60,
  },
  // A first, quick check on what the browser says. imageService checks the file's bytes as well.
  fileFilter(req, file, done) {
    if (
      ALLOWED_TYPES.has(file.mimetype) &&
      /\.(jpe?g|png|webp)$/i.test(file.originalname)
    )
      return done(null, true);
    return done(
      new HttpError(400, 'Only JPG, PNG or WEBP images can be uploaded.', {
        images: 'Only JPG, PNG or WEBP images can be uploaded.',
      }),
    );
  },
});

const MULTER_MESSAGES = {
  LIMIT_FILE_SIZE: 'Each image must be 2 MB or smaller.',
  LIMIT_FILE_COUNT: `You can upload up to ${MAX_IMAGES} images.`,
  LIMIT_UNEXPECTED_FILE: `You can upload up to ${MAX_IMAGES} images.`,
  LIMIT_FIELD_COUNT:
    'The form has too many fields. Reload the page and try again.',
  LIMIT_FIELD_KEY:
    'The form has a field name that is too long. Reload the page and try again.',
  LIMIT_FIELD_VALUE:
    'One of the form values is too long. Shorten it and try again.',
  LIMIT_PART_COUNT:
    'The upload has too many parts. Reload the page and try again.',
};

// Reads a multipart form with up to MAX_IMAGES files in the "images" field.
// Upload problems become normal 400 errors with a message under the images field.
function productImages(req, res, next) {
  upload.array('images', MAX_IMAGES)(req, res, (error) => {
    if (!error) return next();
    if (error instanceof HttpError) return next(error);
    if (error instanceof multer.MulterError) {
      const message =
        MULTER_MESSAGES[error.code] ||
        'The upload could not be read. Please try again.';
      return next(new HttpError(400, message, {images: message}));
    }
    return next(error);
  });
}

// Up to MAX_RETURN_PHOTOS photos in the "photos" field of a return request. A JSON request
// (no photos) passes straight through.
function returnPhotos(req, res, next) {
  upload.array('photos', MAX_RETURN_PHOTOS)(req, res, (error) => {
    if (!error) return next();
    if (error instanceof HttpError)
      return next(new HttpError(400, error.message, {photos: error.message}));
    if (error instanceof multer.MulterError) {
      const message =
        error.code === 'LIMIT_FILE_SIZE'
          ? 'Each photo must be 2 MB or smaller.'
          : `You can add up to ${MAX_RETURN_PHOTOS} photos.`;
      return next(new HttpError(400, message, {photos: message}));
    }
    return next(error);
  });
}

// E3: up to 3 photos in the "photos" field of a review. A JSON review (no photos) passes straight through.
function reviewPhotos(req, res, next) {
  upload.array('photos', 3)(req, res, (error) => {
    if (!error) return next();
    if (error instanceof HttpError)
      return next(new HttpError(400, error.message, {photos: error.message}));
    if (error instanceof multer.MulterError) {
      const message =
        error.code === 'LIMIT_FILE_SIZE'
          ? 'Each photo must be 2 MB or smaller.'
          : 'You can add up to 3 photos.';
      return next(new HttpError(400, message, {photos: message}));
    }
    return next(error);
  });
}

// One photo in the "image" field of the admin category form. A JSON request passes straight through.
function categoryImage(req, res, next) {
  upload.array('image', 1)(req, res, (error) => {
    if (!error) return next();
    if (error instanceof HttpError)
      return next(new HttpError(400, error.message, {image: error.message}));
    if (error instanceof multer.MulterError) {
      const message =
        error.code === 'LIMIT_FILE_SIZE'
          ? 'The photo must be 2 MB or smaller.'
          : 'Add one photo only.';
      return next(new HttpError(400, message, {image: message}));
    }
    return next(error);
  });
}

module.exports = {
  categoryImage,
  productImages,
  returnPhotos,
  reviewPhotos,
};
