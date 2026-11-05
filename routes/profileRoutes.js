const router = require("express").Router();
const { getProfile, updateProfile, changePassword } = require("../controllers/profileController");
const { requireAuth, requireRole } = require("../middleware/auth");
const { sensitiveLimiter } = require("../middleware/rateLimit");

// Mounted at /api/profile. Every route here needs a signed-in customer.
router.use(requireAuth, requireRole("customer"));
router.get("/", getProfile);
router.patch("/", updateProfile);
router.patch("/password", sensitiveLimiter, changePassword);

module.exports = router;
