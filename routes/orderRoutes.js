const router = require("express").Router();
const orders = require("../controllers/orderController");
const { requireAuth, requireRole } = require("../middleware/auth");
const { returnPhotos } = require("../middleware/upload");
const { orderLimiter, sensitiveLimiter } = require("../middleware/rateLimit");

// Mounted at /api. Checkout and orders are for signed-in customers only.
const customer = [requireAuth, requireRole("customer")];
router.post("/checkout/quote", customer, orders.quote);
// Buy now: one product checked out on its own; the cart is left as it is.
router.post("/buy-now", customer, orderLimiter, orders.buyNow);
// E2: the code that confirms a Cash on Delivery order (when the admin turned it on).
router.post("/checkout/cod-code", customer, sensitiveLimiter, orders.sendCodCode);
router.post("/orders", customer, orderLimiter, orders.placeOrder);
router.get("/orders", customer, orders.listOrders);
router.get("/orders/:orderId", customer, orders.getOrder);
router.post("/orders/:orderId/cancel", customer, orders.cancelOrder);
router.post("/orders/:orderId/items/:itemId/cancel", customer, orders.cancelItem);
router.post("/orders/:orderId/return", customer, returnPhotos, orders.requestReturn);

module.exports = router;
