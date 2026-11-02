const router = require("express").Router();
const { dashboard, listCustomers, setCustomerBlocked } = require("../controllers/adminController");
const { requireAuth, requireRole } = require("../middleware/auth");

// Mounted at /api/admin. Admin login lives in authRoutes, so it is reached before this guard.
router.use(requireAuth, requireRole("admin"));
router.get("/dashboard", dashboard);
router.get("/customers", listCustomers);
router.patch("/customers/:userId/block", setCustomerBlocked);

module.exports = router;
