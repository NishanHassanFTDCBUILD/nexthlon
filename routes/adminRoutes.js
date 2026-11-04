const router = require("express").Router();
const { dashboard, listCustomers, setCustomerBlocked } = require("../controllers/adminController");
const products = require("../controllers/adminProductController");
const { requireAuth, requireRole } = require("../middleware/auth");
const { productImages } = require("../middleware/upload");

// Mounted at /api/admin. Admin login lives in authRoutes, so it is reached before this guard.
router.use(requireAuth, requireRole("admin"));
router.get("/dashboard", dashboard);
router.get("/customers", listCustomers);
router.patch("/customers/:userId/block", setCustomerBlocked);

// Products. Uploads are read only after the admin check above, so guests cannot send files.
router.get("/products", products.listProducts);
router.post("/products", productImages, products.createProduct);
router.get("/products/:productId", products.getProduct);
router.patch("/products/:productId", productImages, products.updateProduct);
router.patch("/products/:productId/listing", products.setListed);

module.exports = router;
