// The admin console's pages, mounted at the private ADMIN_PATH (config.adminPath).
// Only the exact login URL answers visitors; every other page is a plain 404 unless an admin is
// signed in, so the console's existence is never revealed. The admin APIs live under /api/admin.
//
// The console has exactly the sections in config/adminNav.js, and every one of them is built:
// there are no placeholder pages, so an unknown URL here is an ordinary 404.
// Support tickets no longer have an admin screen; their JSON API stays so the customer side
// (My Account > Help) keeps working.
const router = require("express").Router();
const config = require("../config/env");
const pages = require("../controllers/pageController");
const sales = require("../controllers/adminSalesPageController");
const catalog = require("../controllers/adminCatalogPageController");
const { ADMIN_NAV } = require("../config/adminNav");
const { adminPage, adminGuestOnly } = require("../middleware/auth");
const { adminShell } = require("../middleware/shell");

// Admin pages get the base path for links, the sidebar sections, and are never indexed. This runs
// only for the login page and for signed-in admins, so anyone else's 404 here is identical to
// any other 404.
function adminLocals(req, res, next) {
  res.locals.adminPath = config.adminPath;
  res.locals.adminNav = ADMIN_NAV;
  res.locals.noindex = true;
  res.set("X-Robots-Tag", "noindex, nofollow");
  next();
}

router.get("/login", adminLocals, adminGuestOnly, pages.adminLogin);

// Everything below needs a signed-in admin (anyone else: 404). The console is a calm work area
// that switches sections without a reload (adminShell: no store motion, X-Partial support).
router.use(adminPage, adminLocals, adminShell);
router.get("/", (req, res) => res.redirect(`${config.adminPath}/dashboard`));

// ---------- Overview ----------
router.get("/dashboard", pages.adminDashboard);
router.get("/analytics", pages.adminAnalytics);

// ---------- Sales ----------
router.get("/orders", sales.orders);
router.get("/orders/:orderId", sales.order);
router.get("/returns", sales.returns);
router.get("/transactions", sales.transactions);
router.get("/transactions/reconciliation", sales.reconciliation);
router.get("/transactions/:id", sales.transaction);
router.get("/refunds", sales.refunds);
router.get("/abandoned-carts", sales.abandonedCarts);
// Coupons: the fixed paths come before /:couponId so "new" is never read as an id.
router.get("/coupons", sales.coupons);
router.get("/coupons/new", sales.couponNew);
router.get("/coupons/:couponId/edit", sales.couponEdit);
router.get("/coupons/:couponId", sales.coupon);

// ---------- Catalog ----------
router.get("/products", pages.adminProducts);
router.get("/products/new", pages.adminProductNew);
router.get("/products/:productId/edit", pages.adminProductEdit);
router.get("/inventory", catalog.inventory);

// ---------- Customers ----------
router.get("/customers", pages.adminUsers);
router.get("/questions", catalog.questions);
// The old address of the customer list.
router.get("/users", (req, res) => {
  const query = req.originalUrl.indexOf("?");
  res.redirect(301, `${config.adminPath}/customers${query >= 0 ? req.originalUrl.slice(query) : ""}`);
});

// ---------- System ----------
router.get("/settings", pages.adminSettings);
router.get("/system", catalog.system);

module.exports = router;
