const productService = require('../services/productService');
const reviewService = require('../services/reviewService');
const shippingService = require('../services/shippingService');
const stockAlertService = require('../services/stockAlertService');
const imageService = require('../services/imageService');
const questionService = require('../services/questionService');
const {lookupPincode} = require('../services/pincodeService');
const {HttpError, asyncHandler} = require('../utils/http');
const {readIdList, validateReview, hasErrors} = require('../utils/validators');
const searchInsightService = require('../services/searchInsightService');

// GET /api/products?q=&category=&brand=&min=&max=&discount=&rating=&inStock=1&sort=&page=
// Prices are in paise; min and max in the query are whole rupees.
const listProducts = asyncHandler(async (req, res) => {
  const {products, pagination, filters, facets, correctedQuery} =
    await productService.listProducts(req.query);
  res.json({
    products: products.map(productService.toPublicProduct),
    pagination,
    filters,
    facets,
    correctedQuery,
  });
});

// GET /api/products/search?q=
const searchProducts = asyncHandler(async (req, res) => {
  if (typeof req.query.q !== 'string' || !req.query.q.trim()) {
    throw new HttpError(400, 'Enter something to search for.');
  }
  return listProducts(req, res);
});

// GET /api/search/start   what the search panel shows before anything is typed: popular searches,
// sports and products popular right now. The same for everyone (a CDN may keep it for signed-out visitors).
const searchStart = asyncHandler(async (req, res) => {
  res.json(await searchInsightService.startPanel());
});

// GET /api/products/lookup?ids=id1,id2   (wishlist and "recently viewed", saved in the browser)
// Returns only listed products, in the order asked for. Up to 50 ids.
const lookupProducts = asyncHandler(async (req, res) => {
  const ids = readIdList(req.query.ids, 50);
  const products = await productService.getProductsByIds(ids);
  res.json({products: products.map(productService.toPublicProduct)});
});

// GET /api/products/:id   (accepts the product id or its slug)
const getProduct = asyncHandler(async (req, res) => {
  const product = await productService.getProduct(req.params.id);
  if (!product) throw new HttpError(404, 'Product not found.');
  res.json({product: productService.toPublicProduct(product)});
});

// GET /api/categories
const listCategories = asyncHandler(async (req, res) => {
  res.json({categories: await productService.getCategorySummaries()});
});

// GET /api/products/:id/reviews?page=
const listReviews = asyncHandler(async (req, res) => {
  const product = await productService.getProduct(req.params.id);
  if (!product) throw new HttpError(404, 'Product not found.');
  const page = productService.toPositiveInt(req.query.page, 1);
  res.json(
    await reviewService.listReviews(
      product._id,
      page,
      req.user && req.user.role === 'customer' ? req.user._id : null,
    ),
  );
});

// POST /api/products/:id/reviews   body: { rating, title, body }   (any signed-in customer)
const addReview = asyncHandler(async (req, res) => {
  const {errors, value} = validateReview(req.body);
  if (hasErrors(errors))
    throw new HttpError(400, Object.values(errors)[0], errors);
  const files = req.files || [];
  const fake = imageService.findFakeImages(files);
  if (fake.length)
    throw new HttpError(
      400,
      'Only real JPG, PNG or WEBP photos can be added.',
      {photos: 'Only real JPG, PNG or WEBP photos can be added.'},
    );
  // Photos are saved only once the review is allowed (E3).
  const result = await reviewService.addReview(req.user, req.params.id, value, {
    savePhotos: files.length
      ? () => imageService.saveImages(files, 'reviews')
      : null,
  });
  res.status(201).json({message: 'Thanks! Your review is live.', ...result});
});

// GET /api/delivery/estimate?pincode=560001
const deliveryEstimate = asyncHandler(async (req, res) => {
  // The rules, confirmed by the courier platform when Shiprocket is set up (services/shippingService.js).
  const estimate = await shippingService.checkPincode(req.query.pincode);
  if (!estimate)
    throw new HttpError(400, 'Enter a valid 6-digit PIN code.', {
      pincode: 'Enter a valid 6-digit PIN code.',
    });
  res.json({estimate});
});

// GET /api/delivery/pincode/560038 -> { place: { pincode, city, state, source } }
// The address form fills city and state from it; both stay editable.
const pincodeLookup = asyncHandler(async (req, res) => {
  const place = await lookupPincode(req.params.pincode);
  if (!place)
    throw new HttpError(400, 'Enter a valid 6-digit PIN code.', {
      pincode: 'Enter a valid 6-digit PIN code.',
    });
  res.set('Cache-Control', 'private, max-age=86400');
  res.json({place});
});

// POST /api/products/:id/stock-alerts   { email?, variantId? }   Signed-in customers may leave out the email.
const addStockAlert = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const user = req.user && req.user.role === 'customer' ? req.user : null;
  const alert = await stockAlertService.subscribe(req.params.id, {
    email: body.email,
    variantId: body.variantId || null,
    user,
  });
  res.status(201).json({
    message: `Done. We'll email ${alert.email} when ${alert.option ? `${alert.option} is` : "it's"} back.`,
    alert,
  });
});

// Product Q&A (E3). GET /api/products/:id/questions?page=  POST /api/products/:id/questions { body }
// POST /api/questions/:questionId/answers { body } (buyers who received it, or the admin)
const listQuestions = asyncHandler(async (req, res) => {
  res.json(
    await questionService.list(
      req.params.id,
      req.query.page,
      req.user ? req.user._id : null,
    ),
  );
});
const askQuestion = asyncHandler(async (req, res) => {
  const question = await questionService.ask(
    req.user,
    req.params.id,
    req.body && req.body.body,
  );
  res.status(201).json({
    message: 'Question posted. You will get an email when someone answers.',
    question,
  });
});
const answerQuestion = asyncHandler(async (req, res) => {
  const question = await questionService.answer(
    req.user,
    req.params.questionId,
    req.body && req.body.body,
  );
  res.status(201).json({message: 'Thanks! Your answer is live.', question});
});

// GET /api/products/suggest?q=  up to 6 listed product names and brands that match what is typed so far.
const suggest = asyncHandler(async (req, res) => {
  const q = String(req.query.q || '')
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .trim()
    .slice(0, 60);
  if (q.length < 2) return res.json({suggestions: []});
  const {LISTED_PRODUCT} = require('../utils/queryFilters');
  const Product = require('../models/Product');
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(^|\\s)${escaped}`, 'i');
  const rows = await Product.find({
    ...LISTED_PRODUCT,
    $or: [{name: pattern}, {brand: pattern}],
  })
    .sort({ratingCount: -1, _id: 1})
    .limit(6)
    .select('name slug brand')
    .lean();
  const seen = new Set();
  const suggestions = rows
    .map((row) => ({label: row.name, slug: row.slug, brand: row.brand}))
    .filter((item) => !seen.has(item.label) && seen.add(item.label));
  res.set('Cache-Control', 'public, max-age=60');
  res.json({suggestions});
});

module.exports = {
  suggest,
  listQuestions,
  askQuestion,
  answerQuestion,
  addStockAlert,
  listProducts,
  searchProducts,
  searchStart,
  lookupProducts,
  getProduct,
  listCategories,
  listReviews,
  addReview,
  deliveryEstimate,
  pincodeLookup,
};
