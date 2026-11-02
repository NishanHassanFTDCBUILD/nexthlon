const router = require("express").Router();
const { signup, login, adminLogin, me, logout } = require("../controllers/authController");
const { requireAuth, requireRole } = require("../middleware/auth");
const { authLimiter } = require("../middleware/rateLimit");

// Mounted at /api
router.post("/signup", authLimiter, signup);
router.post("/login", authLimiter, login);
router.post("/admin/login", authLimiter, adminLogin);
router.get("/me", requireAuth, me);
router.post("/logout", logout);
router.post("/admin/logout", requireAuth, requireRole("admin"), logout);

module.exports = router;
