// The admin console's pages, mounted at the private ADMIN_PATH (config.adminPath).
// Only the exact login URL answers visitors; every other page is a plain 404 unless an admin is
// signed in, so the console's existence is never revealed. The admin APIs live under /api/admin.
const router = require("express").Router();
const config = require("../config/env");
const pages = require("../controllers/pageController");
const account = require("../controllers/accountPageController");
const { adminPage, adminGuestOnly } = require("../middleware/auth");

// Admin pages get the base path for links and are never indexed. This runs only for the login
// page and for signed-in admins, so anyone else's 404 here is identical to any other 404.
function adminLocals(req, res, next) {
  res.locals.adminPath = config.adminPath;
  res.locals.noindex = true;
  res.set("X-Robots-Tag", "noindex, nofollow");
  next();
}

router.get("/login", adminLocals, adminGuestOnly, pages.adminLogin);

// Everything below needs a signed-in admin (anyone else: 404).
router.use(adminPage, adminLocals);
router.get("/", (req, res) => res.redirect(`${config.adminPath}/dashboard`));
router.get("/dashboard", pages.adminDashboard);
router.get("/users", pages.adminUsers);
router.get("/tickets", account.adminTickets);
router.get("/tickets/:ticketId", account.adminTicket);
router.get("/products", pages.adminProducts);
router.get("/products/new", pages.adminProductNew);
router.get("/products/:productId/edit", pages.adminProductEdit);

module.exports = router;
