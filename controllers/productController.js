const productService = require("../services/productService");
const reviewService = require("../services/reviewService");
const { estimateDelivery } = require("../services/deliveryService");
const { lookupPincode } = require("../services/pincodeService");
const { HttpError, asyncHandler } = require("../utils/http");
const { readIdList, validateReview, hasErrors } = require("../utils/validators");

// GET /api/products?q=&category=&brand=&min=&max=&discount=&rating=&inStock=1&sort=&page=
// Prices are in paise; min and max in the query are whole rupees.
const listProducts = asyncHandler(async (req, res) => {
  const { products, pagination, filters, facets, correctedQuery } = await productService.listProducts(req.query);
  res.json({ products: products.map(productService.toPublicProduct), pagination, filters, facets, correctedQuery });
});

// GET /api/products/search?q=
const searchProducts = asyncHandler(async (req, res) => {
  if (typeof req.query.q !== "string" || !req.query.q.trim()) {
    throw new HttpError(400, "Enter something to search for.");
  }
  return listProducts(req, res);
});

// GET /api/products/lookup?ids=id1,id2   (wishlist and "recently viewed", saved in the browser)
// Returns only listed products, in the order asked for. Up to 50 ids.
const lookupProducts = asyncHandler(async (req, res) => {
  const ids = readIdList(req.query.ids, 50);
  const products = await productService.getProductsByIds(ids);
  res.json({ products: products.map(productService.toPublicProduct) });
});

// GET /api/products/:id   (accepts the product id or its slug)
const getProduct = asyncHandler(async (req, res) => {
  const product = await productService.getProduct(req.params.id);
  if (!product) throw new HttpError(404, "Product not found.");
  res.json({ product: productService.toPublicProduct(product) });
});

// GET /api/categories
const listCategories = asyncHandler(async (req, res) => {
  res.json({ categories: await productService.getCategorySummaries() });
});

// GET /api/products/:id/reviews?page=
const listReviews = asyncHandler(async (req, res) => {
  const product = await productService.getProduct(req.params.id);
  if (!product) throw new HttpError(404, "Product not found.");
  const page = productService.toPositiveInt(req.query.page, 1);
  res.json(await reviewService.listReviews(product._id, page, req.user && req.user.role === "customer" ? req.user._id : null));
});

// POST /api/products/:id/reviews   body: { rating, title, body }   (any signed-in customer)
const addReview = asyncHandler(async (req, res) => {
  const { errors, value } = validateReview(req.body);
  if (hasErrors(errors)) throw new HttpError(400, Object.values(errors)[0], errors);
  const result = await reviewService.addReview(req.user, req.params.id, value);
  res.status(201).json({ message: "Thanks! Your review is live.", ...result });
});

// GET /api/delivery/estimate?pincode=560001
const deliveryEstimate = asyncHandler(async (req, res) => {
  const estimate = estimateDelivery(req.query.pincode);
  if (!estimate) throw new HttpError(400, "Enter a valid 6-digit PIN code.", { pincode: "Enter a valid 6-digit PIN code." });
  res.json({ estimate });
});

// GET /api/delivery/pincode/560038 -> { place: { pincode, city, state, source } }
// The address form fills city and state from it; both stay editable.
const pincodeLookup = asyncHandler(async (req, res) => {
  const place = await lookupPincode(req.params.pincode);
  if (!place) throw new HttpError(400, "Enter a valid 6-digit PIN code.", { pincode: "Enter a valid 6-digit PIN code." });
  res.set("Cache-Control", "private, max-age=86400");
  res.json({ place });
});

module.exports = { listProducts, searchProducts, lookupProducts, getProduct, listCategories, listReviews, addReview, deliveryEstimate, pincodeLookup };
