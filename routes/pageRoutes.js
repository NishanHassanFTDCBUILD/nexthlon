const router = require("express").Router();
const pages = require("../controllers/pageController");
const account = require("../controllers/accountPageController");
const { customerPage, guestOnly } = require("../middleware/auth");
const { accountShell } = require("../middleware/shell");
const recovery = require("../controllers/recoveryController");

// My Account pages: signed-in customers only, without the store's motion layer.
const accountPage = [customerPage, accountShell];

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
// Forgotten password and email confirmation. The reset and confirm pages open from the links in emails,
// so they work whether or not someone is signed in.
router.get("/forgot-password", guestOnly, recovery.forgotPage);
router.get("/reset-password", recovery.resetPage);
router.get("/verify-email", recovery.verifyPage);
// My Account. The older short URLs (/profile, /orders, /wallet, /wishlist) still work.
router.get("/account", accountPage, account.overview);
router.get(["/account/addresses", "/profile"], accountPage, pages.profile);
router.get("/account/buy-again", accountPage, account.buyAgain);
router.get("/account/coupons", accountPage, account.coupons);
router.get(["/account/lists", "/wishlist"], accountPage, account.lists);
router.get("/account/recent", accountPage, account.recent);
router.get("/account/security", accountPage, account.security);
router.get("/account/notifications", accountPage, account.notifications);
router.get("/account/referral", accountPage, account.referral);
router.get("/account/help", accountPage, account.help);
router.get("/account/help/:ticketId", accountPage, account.ticket);
router.get("/lists/:shareId", account.sharedList);
router.get("/cart", customerPage, pages.cart);
router.get("/checkout", customerPage, pages.checkout);
router.get(["/account/orders", "/orders"], accountPage, pages.orders);
router.get(["/account/wallet", "/wallet"], accountPage, pages.wallet);
router.get("/orders/:orderId", accountPage, pages.orderDetail);
router.get("/orders/:orderId/success", customerPage, pages.orderSuccess);
router.get("/orders/:orderId/invoice", customerPage, pages.orderInvoice);

module.exports = router;
