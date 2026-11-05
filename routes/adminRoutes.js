const router = require("express").Router();
const { dashboard, search, notifications, listCustomers, setCustomerBlocked, getSettings, updateReferral, listTickets, replyTicket } = require("../controllers/adminController");
const products = require("../controllers/adminProductController");
const reports = require("../controllers/adminReportController");
const orders = require("../controllers/adminOrderController");
const { adminWriteLimiter, adminMoneyLimiter } = require("../middleware/rateLimit");
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

// Orders (specific paths before /:orderId)
router.get("/orders", orders.listOrders);
router.get("/orders/export.:format(csv|xlsx)", orders.exportOrders);
router.post("/orders/bulk-status", adminWriteLimiter, orders.bulkStatus);
router.get("/orders/:orderId", orders.getOrder);
router.patch("/orders/:orderId/status", adminWriteLimiter, orders.setStatus);
router.post("/orders/:orderId/cancel", adminMoneyLimiter, orders.cancelItems);
router.post("/orders/:orderId/shipments", adminWriteLimiter, orders.addShipment);
router.post("/orders/:orderId/notes", adminWriteLimiter, orders.addNote);
router.post("/orders/:orderId/refunds", adminMoneyLimiter, orders.refund);
router.get("/orders/:orderId/invoice.pdf", orders.invoicePdf);
router.get("/orders/:orderId/packing-slip.pdf", orders.packingSlipPdf);

// Returns
router.get("/returns", orders.listReturns);
router.post("/returns/:orderId/decision", adminMoneyLimiter, orders.decideReturn);

// The money ledger, refunds and reconciliation
router.get("/transactions", orders.listTransactions);
router.get("/transactions/export.:format(csv|xlsx)", orders.exportTransactions);
router.get("/transactions/reconciliation", orders.reconciliation);
router.get("/transactions/:id", orders.getTransaction);
router.get("/refunds", orders.listRefunds);

// Abandoned carts
router.get("/abandoned-carts", orders.listAbandoned);
router.post("/abandoned-carts/:cartId/remind", adminMoneyLimiter, orders.remindCart);

module.exports = router;
