// The admin console's pages, mounted at the private ADMIN_PATH (config.adminPath).
// Only the exact login URL answers visitors; every other page is a plain 404 unless an admin is
// signed in, so the console's existence is never revealed. The admin APIs live under /api/admin.
const router = require("express").Router();
const config = require("../config/env");
const pages = require("../controllers/pageController");
const account = require("../controllers/accountPageController");
const sales = require("../controllers/adminSalesPageController");
const { ADMIN_NAV, findSection } = require("../config/adminNav");
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
router.get("/dashboard", pages.adminDashboard);
router.get("/customers", pages.adminUsers);
// The old address of the customer list.
router.get("/users", (req, res) => {
  const query = req.originalUrl.indexOf("?");
  res.redirect(301, `${config.adminPath}/customers${query >= 0 ? req.originalUrl.slice(query) : ""}`);
});
router.get("/tickets", account.adminTickets);
router.get("/tickets/:ticketId", account.adminTicket);
router.get("/products", pages.adminProducts);
router.get("/products/new", pages.adminProductNew);
router.get("/products/:productId/edit", pages.adminProductEdit);
router.get("/settings", pages.adminSettings);
router.get("/orders", sales.orders);
router.get("/orders/:orderId", sales.order);
router.get("/returns", sales.returns);
router.get("/transactions", sales.transactions);
router.get("/transactions/reconciliation", sales.reconciliation);
router.get("/transactions/:id", sales.transaction);
router.get("/refunds", sales.refunds);
router.get("/abandoned-carts", sales.abandonedCarts);

// Sections that are still being built show a short notice instead of a 404.
const PROFILE = { key: "profile", label: "Your profile", icon: "user", group: "Account", part: 6 };
router.get("/:section", (req, res, next) => {
  const item = req.params.section === "profile" ? PROFILE : findSection(req.params.section);
  if (!item || item.ready) return next();
  res.render("admin/soon", { title: `${item.label} | Nexthlon Admin`, item });
});

module.exports = router;
