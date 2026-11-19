// The admin console's pages, mounted at the private ADMIN_PATH (config.adminPath).
// Only the exact login URL answers visitors; every other page is a plain 404 unless an admin is
// signed in, so the console's existence is never revealed. The admin APIs live under /api/admin.
//
// The console has exactly the sections in config/adminNav.js, and every one of them is built:
// there are no placeholder pages, so an unknown URL here is an ordinary 404.
// Support tickets no longer have an admin screen; their JSON API stays so the customer side
// (My Account > Help) keeps working.
const router = require('express').Router();
const config = require('../config/env');
const pages = require('../controllers/pageController');
const sales = require('../controllers/adminSalesPageController');
const catalog = require('../controllers/adminCatalogPageController');
const {ADMIN_NAV, navFor} = require('../config/adminNav');
const {adminPage, adminGuestOnly} = require('../middleware/auth');
const {adminShell} = require('../middleware/shell');

// Admin pages get the base path for links, the sidebar sections, and are never indexed. This runs
// only for the login page and for signed-in admins, so anyone else's 404 here is identical to
// any other 404.
function adminLocals(req, res, next) {
  res.locals.adminPath = config.adminPath;
  res.locals.adminNav = req.user
    ? navFor(require('../utils/permissions').roleOf(req.user))
    : ADMIN_NAV;
  res.locals.noindex = true;
  res.set('X-Robots-Tag', 'noindex, nofollow');
  next();
}

router.get('/login', adminLocals, adminGuestOnly, pages.adminLogin);

// Everything below needs a signed-in admin (anyone else: 404). The console is a calm work area
// that switches sections without a reload (adminShell: no store motion, X-Partial support).
router.use(adminPage, adminLocals, adminShell);
router.get('/', (req, res) => res.redirect(`${config.adminPath}/dashboard`));

// ---------- Overview ----------
router.get('/dashboard', pages.adminDashboard);
router.get('/analytics', pages.adminAnalytics);

// ---------- Sales ----------
router.get('/orders', sales.orders);
// The pick list must come before /orders/:orderId, or 'pick-list' would be read as an order number.
router.get('/orders/pick-list', sales.pickList);
// Batch print: the chosen orders, one page each (the browser prints it or saves it as a PDF).
router.get('/orders/print', sales.printOrders);
router.get('/orders/:orderId', sales.order);
router.get('/returns', sales.returns);
router.get('/transactions', sales.transactions);
router.get('/transactions/reconciliation', sales.reconciliation);
router.get('/transactions/:id', sales.transaction);
router.get('/refunds', sales.refunds);
// Coupons: the fixed paths come before /:couponId so "new" is never read as an id.
router.get('/coupons', sales.coupons);
router.get('/coupons/new', sales.couponNew);
router.get('/coupons/:couponId/edit', sales.couponEdit);
router.get('/coupons/:couponId', sales.coupon);
router.get('/deals', sales.deals);
router.get('/deals/new', sales.dealNew);
router.get('/deals/:dealId/edit', sales.dealEdit);

// ---------- Catalog ----------
router.get('/products', pages.adminProducts);
router.get('/products/new', pages.adminProductNew);
router.get('/products/:productId/edit', pages.adminProductEdit);
router.get('/inventory', catalog.inventory);
router.get('/categories', catalog.categories);
router.get('/categories/new', catalog.categoryNew);
router.get('/categories/:categoryId/edit', catalog.categoryEdit);
router.get('/categories/:categoryId', catalog.category);

// ---------- Customers ----------
router.get('/customers', pages.adminUsers);
// Customer 360: one customer's whole picture (the wallet page below has its own, longer address).
router.get(
  '/customers/:userId',
  require('../controllers/adminCustomerController').customerPage,
);
router.get(
  '/customers/:userId/wallet',
  require('../controllers/adminWalletController').page,
);
router.get('/questions', catalog.questions);
// The old address of the customer list.
router.get('/users', (req, res) => {
  const query = req.originalUrl.indexOf('?');
  res.redirect(
    301,
    `${config.adminPath}/customers${query >= 0 ? req.originalUrl.slice(query) : ''}`,
  );
});

// ---------- System ----------
router.get('/settings', pages.adminSettings);
router.get('/system', catalog.system);

// Staff and the audit log: only the roles that may see them (utils/permissions.js).
const staffPages = require('../controllers/adminStaffController');
const {roleOf, can} = require('../utils/permissions');
const needsPage = (permission) => (req, res, next) =>
  can(roleOf(req.user), permission)
    ? next()
    : next(
        new (require('../utils/http').HttpError)(
          403,
          'Your role does not allow this page.',
        ),
      );
router.get('/staff', needsPage('staff.manage'), staffPages.staffPage);
router.get('/audit', needsPage('audit.read'), staffPages.auditPage);
router.get(
  '/reviews',
  require('../controllers/adminReviewController').reviewsPage,
);
// Support inbox: one page to read and answer customer requests (support.write for replying).
const supportPages = require('../controllers/adminSupportController');
router.get('/support', supportPages.inbox);
router.get('/support/:ticketId', supportPages.ticket);

module.exports = router;
