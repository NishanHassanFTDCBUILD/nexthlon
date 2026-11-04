const router = require("express").Router();
const { listProducts, searchProducts, lookupProducts, getProduct, listCategories } = require("../controllers/productController");

// Mounted at /api. Public: no sign-in needed to browse.
// "/products/search" and "/products/lookup" must come before "/products/:id", or they would be read as ids.
router.get("/products/search", searchProducts);
router.get("/products/lookup", lookupProducts);
router.get("/products", listProducts);
router.get("/products/:id", getProduct);
router.get("/categories", listCategories);

module.exports = router;
