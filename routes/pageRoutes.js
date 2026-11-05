const router = require("express").Router();
const pages = require("../controllers/pageController");
const account = require("../controllers/accountPageController");
const { customerPage, adminPage, guestOnly } = require("../middleware/auth");

// Store
router.get("/", pages.home);
router.get("/products", pages.products);
router.get("/products/:slug", pages.productDetail);

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
// My Account. The older short URLs (/profile, /orders, /wallet, /wishlist) still work.
router.get("/account", customerPage, account.overview);
router.get(["/account/addresses", "/profile"], customerPage, pages.profile);
router.get("/account/buy-again", customerPage, account.buyAgain);
router.get("/account/coupons", customerPage, account.coupons);
router.get(["/account/lists", "/wishlist"], customerPage, account.lists);
router.get("/account/reviews", customerPage, account.reviews);
router.get("/account/recent", customerPage, account.recent);
router.get("/account/security", customerPage, account.security);
router.get("/account/notifications", customerPage, account.notifications);
router.get("/account/referral", customerPage, account.referral);
router.get("/account/help", customerPage, account.help);
router.get("/account/help/:ticketId", customerPage, account.ticket);
router.get("/lists/:shareId", account.sharedList);
router.get("/cart", customerPage, pages.cart);
router.get("/checkout", customerPage, pages.checkout);
router.get(["/account/orders", "/orders"], customerPage, pages.orders);
router.get(["/account/wallet", "/wallet"], customerPage, pages.wallet);
router.get("/orders/:orderId", customerPage, pages.orderDetail);
router.get("/orders/:orderId/success", customerPage, pages.orderSuccess);
router.get("/orders/:orderId/invoice", customerPage, pages.orderInvoice);

// Admin console
router.get("/admin/login", guestOnly, pages.adminLogin);
router.get("/admin", adminPage, pages.adminDashboard);
router.get("/admin/users", adminPage, pages.adminUsers);
router.get("/admin/tickets", adminPage, account.adminTickets);
router.get("/admin/tickets/:ticketId", adminPage, account.adminTicket);
router.get("/admin/products", adminPage, pages.adminProducts);
router.get("/admin/products/new", adminPage, pages.adminProductNew);
router.get("/admin/products/:productId/edit", adminPage, pages.adminProductEdit);

module.exports = router;
