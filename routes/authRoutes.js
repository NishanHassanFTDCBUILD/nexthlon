const router = require("express").Router();
const { signup, login, adminLogin, adminLoginTwoFactor, refresh, me, logout, adminLogout } = require("../controllers/authController");
const recovery = require("../controllers/recoveryController");
const { requireAuth } = require("../middleware/auth");
const { authLimiter, adminLoginLimiter, refreshLimiter, forgotLimiter, linkLimiter, twoFactorLimiter } = require("../middleware/rateLimit");

// Mounted at /api
router.post("/signup", authLimiter, signup);
router.post("/login", authLimiter, login);
router.post("/admin/login", adminLoginLimiter, adminLogin);
// The code after the admin's password (two-step login).
router.post("/admin/login/2fa", twoFactorLimiter, adminLoginTwoFactor);
// Forgotten password, and confirming an email: the links in the emails lead to pages that call these.
router.post("/password/forgot", forgotLimiter, recovery.forgotPassword);
router.post("/password/reset", linkLimiter, recovery.resetPassword);
router.post("/email/verify", linkLimiter, recovery.verifyEmail);
// Renewing the session. It takes no access token: the refresh cookie is the proof, and this is the
// only path that cookie is sent to. Both the store and the admin console use it.
router.post("/auth/refresh", refreshLimiter, refresh);
router.get("/me", requireAuth, me);
router.post("/logout", logout);
router.post("/admin/logout", adminLogout);

module.exports = router;
