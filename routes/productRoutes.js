const siteSettingsService = require('../services/siteSettingsService');
const {HttpError} = require('../utils/http');

// Shopper features an admin can switch off in Settings. When off, posting is refused politely.
const featureOn = (key, message) => (req, res, next) =>
  siteSettingsService.current()[key]
    ? next()
    : next(new HttpError(403, message));
const reviewsOn = featureOn('reviewsOn', 'Reviews are switched off for now.');
const questionsOn = featureOn(
  'questionsOn',
  'Questions are switched off for now.',
);
const alertsOn = featureOn(
  'stockAlertsOn',
  'Back-in-stock alerts are switched off for now.',
);

const router = require('express').Router();
const products = require('../controllers/productController');
const {requireAuth, requireRole} = require('../middleware/auth');
const {
  reviewLimiter,
  pincodeLimiter,
  searchLimiter,
  stockAlertLimiter,
} = require('../middleware/rateLimit');
const {publicCache} = require('../middleware/publicCache');
const {reviewPhotos} = require('../middleware/upload');

// Mounted at /api. Public: no sign-in needed to browse.
// "/products/search" and "/products/lookup" must come before "/products/:id", or they would be read as ids.
router.get('/products/search', searchLimiter, products.searchProducts);
// The search panel before typing: the same for every signed-out visitor, so a CDN may keep it.
router.get('/search/start', publicCache, products.searchStart);
router.get('/products/lookup', searchLimiter, products.lookupProducts);
// As-you-type suggestions (E4): product names and brands that start like the query.
router.get('/products/suggest', searchLimiter, products.suggest);
router.get('/products', searchLimiter, products.listProducts);
router.get('/products/:id/reviews', products.listReviews);
router.post(
  '/products/:id/reviews',
  reviewsOn,
  requireAuth,
  requireRole('customer'),
  reviewLimiter,
  reviewPhotos,
  products.addReview,
);
// "Email me when it's back" (E3). Guests too: they type their email.
router.post(
  '/products/:id/stock-alerts',
  alertsOn,
  stockAlertLimiter,
  products.addStockAlert,
);
// Product questions and answers (E3).
router.get('/products/:id/questions', products.listQuestions);
router.post(
  '/products/:id/questions',
  questionsOn,
  requireAuth,
  requireRole('customer'),
  reviewLimiter,
  products.askQuestion,
);
router.post(
  '/questions/:questionId/answers',
  questionsOn,
  requireAuth,
  requireRole('customer'),
  reviewLimiter,
  products.answerQuestion,
);
router.get('/products/:id', products.getProduct);
router.get('/categories', products.listCategories);
router.get('/delivery/estimate', products.deliveryEstimate);
router.get(
  '/delivery/pincode/:pincode',
  pincodeLimiter,
  products.pincodeLookup,
);

module.exports = router;
