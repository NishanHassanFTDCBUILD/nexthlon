const router = require('express').Router();
const questionService = require('../services/questionService');
const auditService = require('../services/auditService');
const {
  dashboard,
  analytics,
  search,
  notifications,
  listCustomers,
  setCustomerBlocked,
  getSettings,
  updateReferral,
  updateCod,
  updatePrepaid,
  updateCodOtp,
  listTickets,
  replyTicket,
} = require('../controllers/adminController');
const products = require('../controllers/adminProductController');
const productImport = require('../controllers/adminProductImportController');
const reports = require('../controllers/adminReportController');
const orders = require('../controllers/adminOrderController');
const catalog = require('../controllers/adminCatalogController');
const coupons = require('../controllers/adminCouponController');
const categories = require('../controllers/adminCategoryController');
const deals = require('../controllers/adminDealController');
const siteSettings = require('../controllers/adminSiteSettingsController');
const {
  adminWriteLimiter,
  adminMoneyLimiter,
} = require('../middleware/rateLimit');
const {
  requireAuth,
  requireRole,
  requireAdminPermission,
} = require('../middleware/auth');
const {productImages, categoryImage} = require('../middleware/upload');

// Mounted at /api/admin. Admin login lives in authRoutes, so it is reached before this guard.
router.use(requireAuth, requireRole('admin'), requireAdminPermission);

router.get('/dashboard', dashboard);
router.get('/search', search);
router.get('/notifications', notifications);
router.get('/reports/sales.csv', reports.salesCsv);
// Analytics: the JSON behind the section, and the same figures as a CSV.
router.get('/analytics', analytics);
router.get('/reports/analytics.csv', reports.analyticsCsv);
router.get('/customers', listCustomers);
router.get(
  '/customers/:userId/wallet',
  require('../controllers/adminWalletController').get,
);
router.post(
  '/customers/:userId/wallet/adjust',
  adminMoneyLimiter,
  require('../controllers/adminWalletController').adjust,
);
router.patch('/customers/:userId/block', setCustomerBlocked);
// Customer 360: profile JSON and the private note (customers.write for the note).
const customerApi = require('../controllers/adminCustomerController');
router.get('/customers/:userId/profile', customerApi.profileApi);
router.patch('/customers/:userId/note', adminWriteLimiter, customerApi.noteApi);
router.get('/settings', getSettings);
router.patch('/settings/referral', updateReferral);
router.patch('/settings/cod', updateCod);
router.patch('/settings/prepaid', updatePrepaid);
router.patch('/settings/cod-otp', updateCodOtp);
router.get('/settings/site', siteSettings.getSite);
router.patch(
  '/settings/site/:group(business|delivery|catalog|shopper|home)',
  adminMoneyLimiter,
  siteSettings.updateSite,
);

// Support tickets from customers
router.get('/tickets', listTickets);
router.post('/tickets/:ticketId/reply', replyTicket);

// Products. Uploads are read only after the admin check above, so guests cannot send files.
router.get('/products', products.listProducts);
router.post('/products', productImages, products.createProduct);
// Spreadsheet: export first (a fixed path, so it is not read as a product id).
router.get('/products/export.csv', productImport.exportProducts);
router.get('/products/:productId', products.getProduct);
router.patch('/products/:productId', productImages, products.updateProduct);
router.patch('/products/:productId/listing', products.setListed);
router.patch('/products/:productId/stock', products.restock);
// Spreadsheet import: preview saves nothing; apply saves only a clean file.
router.post('/products/import/preview', productImport.previewImport);
router.post(
  '/products/import/apply',
  adminWriteLimiter,
  productImport.applyImport,
);

// Orders (specific paths before /:orderId)
router.get('/orders', orders.listOrders);
router.get('/orders/export.:format(csv|xlsx)', orders.exportOrders);
router.post('/orders/bulk-status', adminWriteLimiter, orders.bulkStatus);
router.get('/orders/:orderId', orders.getOrder);
router.patch('/orders/:orderId/status', adminWriteLimiter, orders.setStatus);
router.post('/orders/:orderId/cancel', adminMoneyLimiter, orders.cancelItems);
router.post(
  '/orders/:orderId/shipments',
  adminWriteLimiter,
  orders.addShipment,
);
router.post('/orders/:orderId/ship', adminWriteLimiter, orders.shipNow);
// Product questions (E3): answer as the team, hide or show.
router.post(
  '/questions/:questionId/answers',
  adminWriteLimiter,
  async (req, res, next) => {
    try {
      const question = await questionService.answer(
        req.user,
        req.params.questionId,
        req.body && req.body.body,
      );
      await auditService.record({
        ...auditService.fromRequest(req),
        action: 'question.answered',
        target: `question:${question.id}`,
      });
      res.status(201).json({
        message: 'Answer posted. The customer gets an email.',
        question,
      });
    } catch (error) {
      next(error);
    }
  },
);
router.patch(
  '/questions/:questionId/hidden',
  adminWriteLimiter,
  async (req, res, next) => {
    try {
      const hidden = req.body && req.body.hidden === true;
      await questionService.setHidden(req.params.questionId, hidden);
      await auditService.record({
        ...auditService.fromRequest(req),
        action: hidden ? 'question.hidden' : 'question.shown',
        target: `question:${req.params.questionId}`,
      });
      res.json({
        message: hidden
          ? 'Question hidden from the store.'
          : 'Question shown again.',
      });
    } catch (error) {
      next(error);
    }
  },
);
// Marketplace feed for Amazon, Flipkart and Myntra (E8): CSV or JSON.
router.get('/marketplace/feed.csv', async (req, res, next) => {
  try {
    const marketplaceService = require('../services/marketplaceService');
    res
      .set('Cache-Control', 'no-store')
      .attachment('nexthlon-marketplace-feed.csv')
      .type('text/csv')
      .send(marketplaceService.toCsv(await marketplaceService.feed()));
  } catch (error) {
    next(error);
  }
});
router.get('/marketplace/feed.json', async (req, res, next) => {
  try {
    const marketplaceService = require('../services/marketplaceService');
    res
      .set('Cache-Control', 'no-store')
      .json({products: await marketplaceService.feed()});
  } catch (error) {
    next(error);
  }
});

router.post('/orders/:orderId/rto', adminMoneyLimiter, orders.markRto);
router.post('/orders/:orderId/notes', adminWriteLimiter, orders.addNote);
router.patch('/orders/:orderId/tags', adminWriteLimiter, orders.setTags);
router.post('/orders/:orderId/refunds', adminMoneyLimiter, orders.refund);
router.get('/orders/:orderId/invoice.pdf', orders.invoicePdf);
router.get('/orders/:orderId/credit-notes/:index.pdf', orders.creditNotePdf);
router.get('/orders/:orderId/packing-slip.pdf', orders.packingSlipPdf);

// Returns
router.get('/returns', orders.listReturns);
router.post(
  '/returns/:orderId/decision',
  adminMoneyLimiter,
  orders.decideReturn,
);

// The money ledger, refunds and reconciliation
router.get('/transactions', orders.listTransactions);
router.get('/transactions/export.:format(csv|xlsx)', orders.exportTransactions);
router.get('/transactions/reconciliation', orders.reconciliation);
router.get('/transactions/:id', orders.getTransaction);
router.get('/refunds', orders.listRefunds);

// Inventory: stock corrections are one atomic update each, and all of them are audit-logged.
router.get('/inventory', catalog.listInventory);
router.get('/inventory/export.csv', catalog.exportInventory);
router.get('/inventory/restock-template.csv', catalog.restockTemplate);
router.post(
  '/inventory/restock/preview',
  adminWriteLimiter,
  catalog.previewRestock,
);
router.post(
  '/inventory/restock/:batchId/apply',
  adminWriteLimiter,
  catalog.applyRestock,
);
router.get('/inventory/:productId/history', catalog.stockHistory);
router.patch('/inventory/:productId', adminWriteLimiter, catalog.adjustStock);
router.patch(
  '/inventory/:productId/reorder',
  adminWriteLimiter,
  catalog.setReorder,
);

// Coupons. Creating and changing one is money, so these use the stricter limiter.
router.get('/coupons', coupons.listCoupons);
router.post('/coupons', adminMoneyLimiter, coupons.createCoupon);
router.get('/coupons/:couponId', coupons.getCoupon);
router.patch('/coupons/:couponId/active', adminWriteLimiter, coupons.setActive);
router.patch('/coupons/:couponId', adminMoneyLimiter, coupons.updateCoupon);
router.delete('/coupons/:couponId', adminMoneyLimiter, coupons.deleteCoupon);

// Categories. A photo upload is read only after the admin check above.
router.get('/categories', categories.listCategories);
router.post(
  '/categories',
  adminWriteLimiter,
  categoryImage,
  categories.createCategory,
);
router.post(
  '/categories/move-products',
  adminWriteLimiter,
  categories.moveProducts,
);
router.patch(
  '/categories/:categoryId/offer',
  adminWriteLimiter,
  categories.setOffer,
);
router.get('/categories/:categoryId', categories.getCategory);
router.patch(
  '/categories/:categoryId/listing',
  adminWriteLimiter,
  categories.setListed,
);
router.patch(
  '/categories/:categoryId',
  adminWriteLimiter,
  categoryImage,
  categories.updateCategory,
);
router.delete(
  '/categories/:categoryId',
  adminWriteLimiter,
  categories.deleteCategory,
);

// Deals of the Day. A deal changes what shoppers pay, so changes use the money limiter.
router.get('/deals', deals.listDeals);
router.post('/deals', adminMoneyLimiter, deals.createDeal);
router.get('/deals/products', deals.searchProducts);
router.get('/deals/:dealId', deals.getDeal);
router.patch('/deals/:dealId/active', adminMoneyLimiter, deals.setActive);
router.patch('/deals/:dealId', adminMoneyLimiter, deals.updateDeal);
router.delete('/deals/:dealId', adminMoneyLimiter, deals.deleteDeal);

// Staff accounts and the audit history (owner or manager; see utils/permissions.js).
const staffApi = require('../controllers/adminStaffController');
router.get('/staff', staffApi.listStaff);
router.post('/staff', adminMoneyLimiter, staffApi.createStaff);
router.patch('/staff/:staffId/role', adminMoneyLimiter, staffApi.setStaffRole);
router.patch(
  '/staff/:staffId/active',
  adminMoneyLimiter,
  staffApi.setStaffActive,
);
router.get('/audit', staffApi.listAudit);

// Reviews moderation (reviews.write; see utils/permissions.js).
const reviewApi = require('../controllers/adminReviewController');
router.get('/reviews', reviewApi.listReviews);
// Operations: webhooks, job queue and the GST report (see utils/permissions.js).
const opsApi = require('../controllers/adminOpsController');
router.get('/webhooks', opsApi.listWebhooks);
router.post(
  '/webhooks/:webhookId/rerun',
  adminMoneyLimiter,
  opsApi.rerunWebhook,
);
router.get('/jobs', opsApi.listJobs);
router.post('/jobs/:jobId/retry', adminWriteLimiter, opsApi.retryJob);
router.get('/reports/gst.csv', opsApi.gstCsv);
// Sales by category and state (reports.read).
const breakdownApi = require('../controllers/adminBreakdownController');
router.get('/reports/breakdown', breakdownApi.breakdownApi);
router.get('/reports/breakdown.csv', breakdownApi.breakdownCsv);

// Saved list views: personal to each admin (any staff role may keep their own).
const viewApi = require('../controllers/adminViewController');
router.get('/views', viewApi.list);
router.post('/views', viewApi.create);
router.delete('/views/:viewId', viewApi.remove);
router.patch(
  '/reviews/:reviewId/hidden',
  adminWriteLimiter,
  reviewApi.setReviewHidden,
);

// System status.
router.get('/system', catalog.systemStatus);

module.exports = router;
