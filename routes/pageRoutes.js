const router = require("express").Router();
const pages = require("../controllers/pageController");
const { customerPage, adminPage, guestOnly } = require("../middleware/auth");

// Store
router.get("/", pages.home);
router.get("/products", pages.products);
router.get("/products/:slug", pages.productDetail);

// Customer account
router.get("/login", guestOnly, pages.login);
router.get("/signup", guestOnly, pages.signup);
router.get("/profile", customerPage, pages.profile);

// Admin console
router.get("/admin/login", guestOnly, pages.adminLogin);
router.get("/admin", adminPage, pages.adminDashboard);
router.get("/admin/users", adminPage, pages.adminUsers);

module.exports = router;
