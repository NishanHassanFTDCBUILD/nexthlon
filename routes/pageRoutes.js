const router = require("express").Router();
const pages = require("../controllers/pageController");
const { customerPage, adminPage, guestOnly } = require("../middleware/auth");

// Store
router.get("/", pages.home);
router.get("/products", pages.products);
router.get("/products/:slug", pages.productDetail);
router.get("/wishlist", customerPage, pages.wishlist);

// Store information and the policies Razorpay asks for
router.get("/about", pages.infoPage("about"));
router.get("/contact", pages.infoPage("contact"));
router.get("/privacy", pages.infoPage("privacy"));
router.get("/terms", pages.infoPage("terms"));
router.get("/refund-policy", pages.infoPage("refund"));
router.get("/shipping-policy", pages.infoPage("shipping"));

// Customer account
router.get("/login", guestOnly, pages.login);
router.get("/signup", guestOnly, pages.signup);
router.get("/profile", customerPage, pages.profile);
router.get("/cart", customerPage, pages.cart);
router.get("/checkout", customerPage, pages.checkout);
router.get("/orders", customerPage, pages.orders);
router.get("/orders/:orderId", customerPage, pages.orderDetail);
router.get("/orders/:orderId/success", customerPage, pages.orderSuccess);
router.get("/orders/:orderId/invoice", customerPage, pages.orderInvoice);

// Admin console
router.get("/admin/login", guestOnly, pages.adminLogin);
router.get("/admin", adminPage, pages.adminDashboard);
router.get("/admin/users", adminPage, pages.adminUsers);
router.get("/admin/products", adminPage, pages.adminProducts);
router.get("/admin/products/new", adminPage, pages.adminProductNew);
router.get("/admin/products/:productId/edit", adminPage, pages.adminProductEdit);

module.exports = router;
