// Complete-the-kit bundles (E6). Mounted at /api.
const router = require("express").Router();
const bundles = require("../controllers/bundleController");
const { requireAuth, requireRole } = require("../middleware/auth");
const { cartLimiter } = require("../middleware/rateLimit");

router.get("/bundles/for/:productId", bundles.forProduct);
router.post("/bundles/:slug/add", requireAuth, requireRole("customer"), cartLimiter, bundles.addAll);

module.exports = router;
