const router = require("express").Router();
const { signup, login, adminLogin, refresh, me, logout, adminLogout } = require("../controllers/authController");
const { requireAuth } = require("../middleware/auth");
const { authLimiter, adminLoginLimiter, refreshLimiter } = require("../middleware/rateLimit");

// Mounted at /api
router.post("/signup", authLimiter, signup);
router.post("/login", authLimiter, login);
router.post("/admin/login", adminLoginLimiter, adminLogin);
// Renewing the session. It takes no access token: the refresh cookie is the proof, and this is the
// only path that cookie is sent to. Both the store and the admin console use it.
router.post("/auth/refresh", refreshLimiter, refresh);
router.get("/me", requireAuth, me);
router.post("/logout", logout);
router.post("/admin/logout", adminLogout);

module.exports = router;
