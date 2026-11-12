const router = require("express").Router();
const products = require("../controllers/productController");
const { requireAuth, requireRole } = require("../middleware/auth");
const { reviewLimiter, pincodeLimiter } = require("../middleware/rateLimit");

// Mounted at /api. Public: no sign-in needed to browse.
// "/products/search" and "/products/lookup" must come before "/products/:id", or they would be read as ids.
router.get("/products/search", products.searchProducts);
router.get("/products/lookup", products.lookupProducts);
router.get("/products", products.listProducts);
router.get("/products/:id/reviews", products.listReviews);
router.post("/products/:id/reviews", requireAuth, requireRole("customer"), reviewLimiter, products.addReview);
router.get("/products/:id", products.getProduct);
router.get("/categories", products.listCategories);
router.get("/delivery/estimate", products.deliveryEstimate);
router.get("/delivery/pincode/:pincode", pincodeLimiter, products.pincodeLookup);

module.exports = router;
