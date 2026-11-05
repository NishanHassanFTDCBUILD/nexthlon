const router = require("express").Router();
const { dashboard, search, notifications, listCustomers, setCustomerBlocked, getSettings, updateReferral, listTickets, replyTicket } = require("../controllers/adminController");
const products = require("../controllers/adminProductController");
const reports = require("../controllers/adminReportController");
const { requireAuth, requireRole } = require("../middleware/auth");
const { productImages } = require("../middleware/upload");

// Mounted at /api/admin. Admin login lives in authRoutes, so it is reached before this guard.
router.use(requireAuth, requireRole("admin"));
router.get("/dashboard", dashboard);
router.get("/search", search);
router.get("/notifications", notifications);
router.get("/reports/sales.csv", reports.salesCsv);
router.get("/customers", listCustomers);
router.patch("/customers/:userId/block", setCustomerBlocked);
router.get("/settings", getSettings);
router.patch("/settings/referral", updateReferral);

// Support tickets from customers
router.get("/tickets", listTickets);
router.post("/tickets/:ticketId/reply", replyTicket);

// Products. Uploads are read only after the admin check above, so guests cannot send files.
router.get("/products", products.listProducts);
router.post("/products", productImages, products.createProduct);
router.get("/products/:productId", products.getProduct);
router.patch("/products/:productId", productImages, products.updateProduct);
router.patch("/products/:productId/listing", products.setListed);
router.patch("/products/:productId/stock", products.restock);

module.exports = router;
