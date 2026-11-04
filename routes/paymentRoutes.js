const router = require("express").Router();
const payments = require("../controllers/paymentController");
const { requireAuth, requireRole } = require("../middleware/auth");

// Mounted at /api/payments. The webhook is NOT here: it needs the raw body and is mounted
// in app.js before the JSON parser and the origin check.
router.use(requireAuth, requireRole("customer"));
router.post("/razorpay/order", payments.createOrder);
router.post("/razorpay/retry/:orderId", payments.retry);
router.post("/razorpay/verify", payments.verify);
router.post("/razorpay/failed", payments.failed);
router.get("/razorpay/status/:razorpayOrderId", payments.status);

module.exports = router;
