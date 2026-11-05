const router = require("express").Router();
const account = require("../controllers/accountController");
const { requireAuth, requireRole } = require("../middleware/auth");
const { sensitiveLimiter } = require("../middleware/rateLimit");

// Mounted at /api/account. Signed-in customers only.
router.use(requireAuth, requireRole("customer"));
router.patch("/email", sensitiveLimiter, account.changeEmail);
router.post("/logout-all", sensitiveLimiter, account.logoutAll);
router.patch("/preferences", account.updatePreferences);
router.delete("/recent", account.clearRecent);
router.post("/delete", sensitiveLimiter, account.deleteAccount);
router.patch("/reviews/:reviewId", account.updateReview);
router.delete("/reviews/:reviewId", account.deleteReview);

module.exports = router;
