const router = require("express").Router();
const products = require("../controllers/productController");
const { requireAuth, requireRole } = require("../middleware/auth");
const questions = require("../controllers/questionController");
const { reviewLimiter, questionLimiter } = require("../middleware/rateLimit");

// Mounted at /api. Public: no sign-in needed to browse.
// "/products/search" and "/products/lookup" must come before "/products/:id", or they would be read as ids.
router.get("/products/search", products.searchProducts);
router.get("/products/lookup", products.lookupProducts);
router.get("/products", products.listProducts);
router.get("/products/:id/reviews", products.listReviews);
router.post("/products/:id/reviews", requireAuth, requireRole("customer"), reviewLimiter, products.addReview);
// Questions & answers. Reading is open to everyone; asking, answering and voting need a customer.
router.get("/products/:id/questions", questions.listQuestions);
router.post("/products/:id/questions", requireAuth, requireRole("customer"), questionLimiter, questions.ask);
router.post("/questions/:questionId/answers", requireAuth, requireRole("customer"), questionLimiter, questions.answer);
router.post("/questions/:questionId/helpful", requireAuth, requireRole("customer"), questions.helpful);
router.get("/products/:id", products.getProduct);
router.get("/categories", products.listCategories);
router.get("/delivery/estimate", products.deliveryEstimate);

module.exports = router;
