const router = require("express").Router();
const { listProducts, searchProducts, getProduct, listCategories } = require("../controllers/productController");

// Mounted at /api. Public: no sign-in needed to browse.
// "/products/search" must come before "/products/:id", or "search" would be read as an id.
router.get("/products/search", searchProducts);
router.get("/products", listProducts);
router.get("/products/:id", getProduct);
router.get("/categories", listCategories);

module.exports = router;
