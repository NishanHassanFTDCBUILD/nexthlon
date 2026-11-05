const router = require("express").Router();
const orders = require("../controllers/orderController");
const { requireAuth, requireRole } = require("../middleware/auth");
const { returnPhotos } = require("../middleware/upload");

// Mounted at /api. Checkout and orders are for signed-in customers only.
const customer = [requireAuth, requireRole("customer")];
router.post("/checkout/quote", customer, orders.quote);
router.post("/orders", customer, orders.placeOrder);
router.get("/orders", customer, orders.listOrders);
router.get("/orders/:orderId", customer, orders.getOrder);
router.post("/orders/:orderId/cancel", customer, orders.cancelOrder);
router.post("/orders/:orderId/items/:itemId/cancel", customer, orders.cancelItem);
router.post("/orders/:orderId/return", customer, returnPhotos, orders.requestReturn);

module.exports = router;
