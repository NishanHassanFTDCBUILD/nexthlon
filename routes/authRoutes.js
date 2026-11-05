const router = require("express").Router();
const { signup, login, adminLogin, me, logout, adminLogout } = require("../controllers/authController");
const { requireAuth } = require("../middleware/auth");
const { authLimiter, adminLoginLimiter } = require("../middleware/rateLimit");

// Mounted at /api
router.post("/signup", authLimiter, signup);
router.post("/login", authLimiter, login);
router.post("/admin/login", adminLoginLimiter, adminLogin);
router.get("/me", requireAuth, me);
router.post("/logout", logout);
router.post("/admin/logout", adminLogout);

module.exports = router;
