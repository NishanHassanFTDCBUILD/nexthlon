const router = require("express").Router();
const questionService = require("../services/questionService");
const auditService = require("../services/auditService");
const { dashboard, analytics, search, notifications, listCustomers, setCustomerBlocked, getSettings, updateReferral, updateCod, updatePrepaid, updateCodOtp, listTickets, replyTicket } = require("../controllers/adminController");
const products = require("../controllers/adminProductController");
const reports = require("../controllers/adminReportController");
const orders = require("../controllers/adminOrderController");
const catalog = require("../controllers/adminCatalogController");
const coupons = require("../controllers/adminCouponController");
const { adminWriteLimiter, adminMoneyLimiter } = require("../middleware/rateLimit");
const twoFactor = require("../controllers/twoFactorController");
const { requireAuth, requireRole } = require("../middleware/auth");
const { requireTwoFactorSetup } = require("../middleware/twoFactorGuard");
const { sensitiveLimiter } = require("../middleware/rateLimit");
const { productImages } = require("../middleware/upload");

// Mounted at /api/admin. Admin login lives in authRoutes, so it is reached before this guard.
router.use(requireAuth, requireRole("admin"));

// Two-step login. Before the guard below, so an admin who is required to turn it on can reach these.
router.get("/2fa", twoFactor.status);
router.post("/2fa/setup", sensitiveLimiter, twoFactor.setup);
router.post("/2fa/enable", sensitiveLimiter, twoFactor.enable);
router.post("/2fa/disable", sensitiveLimiter, twoFactor.disable);
router.post("/2fa/recovery-codes", sensitiveLimiter, twoFactor.regenerate);
// With ADMIN_REQUIRE_2FA=true, nothing else works until two-step login is on.
router.use(requireTwoFactorSetup);

router.get("/dashboard", dashboard);
router.get("/search", search);
router.get("/notifications", notifications);
router.get("/reports/sales.csv", reports.salesCsv);
// Analytics: the JSON behind the section, and the same figures as a CSV.
router.get("/analytics", analytics);
router.get("/reports/analytics.csv", reports.analyticsCsv);
router.get("/customers", listCustomers);
router.patch("/customers/:userId/block", setCustomerBlocked);
router.get("/settings", getSettings);
router.patch("/settings/referral", updateReferral);
router.patch("/settings/cod", updateCod);
router.patch("/settings/prepaid", updatePrepaid);
router.patch("/settings/cod-otp", updateCodOtp);

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
router.post("/orders/:orderId/ship", adminWriteLimiter, orders.shipNow);
// Product questions (E3): answer as the team, hide or show.
router.post("/questions/:questionId/answers", adminWriteLimiter, async (req, res, next) => {
  try {
    const question = await questionService.answer(req.user, req.params.questionId, req.body && req.body.body);
    await auditService.record({ ...auditService.fromRequest(req), action: "question.answered", target: `question:${question.id}` });
    res.status(201).json({ message: "Answer posted. The customer gets an email.", question });
  } catch (error) { next(error); }
});
router.patch("/questions/:questionId/hidden", adminWriteLimiter, async (req, res, next) => {
  try {
    const hidden = req.body && req.body.hidden === true;
    await questionService.setHidden(req.params.questionId, hidden);
    await auditService.record({ ...auditService.fromRequest(req), action: hidden ? "question.hidden" : "question.shown", target: `question:${req.params.questionId}` });
    res.json({ message: hidden ? "Question hidden from the store." : "Question shown again." });
  } catch (error) { next(error); }
});
// Marketplace feed for Amazon, Flipkart and Myntra (E8): CSV or JSON.
router.get("/marketplace/feed.csv", async (req, res, next) => {
  try {
    const marketplaceService = require("../services/marketplaceService");
    res.set("Cache-Control", "no-store").attachment("nexthlon-marketplace-feed.csv").type("text/csv").send(marketplaceService.toCsv(await marketplaceService.feed()));
  } catch (error) { next(error); }
});
router.get("/marketplace/feed.json", async (req, res, next) => {
  try {
    const marketplaceService = require("../services/marketplaceService");
    res.set("Cache-Control", "no-store").json({ products: await marketplaceService.feed() });
  } catch (error) { next(error); }
});

router.post("/orders/:orderId/rto", adminMoneyLimiter, orders.markRto);
router.post("/orders/:orderId/notes", adminWriteLimiter, orders.addNote);
router.post("/orders/:orderId/refunds", adminMoneyLimiter, orders.refund);
router.get("/orders/:orderId/invoice.pdf", orders.invoicePdf);
router.get("/orders/:orderId/credit-notes/:index.pdf", orders.creditNotePdf);
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

// Inventory: stock corrections are one atomic update each, and all of them are audit-logged.
router.get("/inventory", catalog.listInventory);
router.get("/inventory/export.csv", catalog.exportInventory);
router.patch("/inventory/:productId", adminWriteLimiter, catalog.adjustStock);

// Coupons. Creating and changing one is money, so these use the stricter limiter.
router.get("/coupons", coupons.listCoupons);
router.post("/coupons", adminMoneyLimiter, coupons.createCoupon);
router.get("/coupons/:couponId", coupons.getCoupon);
router.patch("/coupons/:couponId/active", adminWriteLimiter, coupons.setActive);
router.patch("/coupons/:couponId", adminMoneyLimiter, coupons.updateCoupon);
router.delete("/coupons/:couponId", adminMoneyLimiter, coupons.deleteCoupon);

// System status.
router.get("/system", catalog.systemStatus);

module.exports = router;
