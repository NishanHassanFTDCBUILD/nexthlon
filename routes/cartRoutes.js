const router = require("express").Router();
const cart = require("../controllers/cartController");
const { requireAuth, requireRole } = require("../middleware/auth");

// Mounted at /api/cart. Only signed-in customers have a cart.
router.use(requireAuth, requireRole("customer"));
router.get("/", cart.getCart);
router.delete("/", cart.clearCart);
router.post("/items", cart.addItem);
router.patch("/items/:productId", cart.updateItem);
router.delete("/items/:productId", cart.removeItem);

module.exports = router;
