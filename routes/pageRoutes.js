const router = require("express").Router();
const pages = require("../controllers/pageController");
const account = require("../controllers/accountPageController");
const { customerPage, guestOnly } = require("../middleware/auth");
const { accountShell } = require("../middleware/shell");
const { publicCache } = require("../middleware/publicCache");
const recovery = require("../controllers/recoveryController");

// My Account pages: signed-in customers only, without the store's motion layer.
const accountPage = [customerPage, accountShell];

// Store. For signed-out visitors these pages may be kept by a CDN for a short time
// (middleware/publicCache.js); the cart, checkout and account pages never are.
router.get("/", publicCache, pages.home);
router.get("/products", publicCache, pages.products);
router.get("/products/:slug", publicCache, pages.productDetail);

// Store information and the policies Razorpay asks for
router.get("/about", publicCache, pages.infoPage("about"));
router.get("/contact", publicCache, pages.infoPage("contact"));
router.get("/privacy", publicCache, pages.infoPage("privacy"));
router.get("/terms", publicCache, pages.infoPage("terms"));
router.get("/refund-policy", publicCache, pages.infoPage("refund"));
router.get("/shipping-policy", publicCache, pages.infoPage("shipping"));

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
// Guests have a cart too (kept by a cookie); checkout below asks them to sign in. A login that is
// blocked or has run out is handled exactly like the account pages (sign-in page, or a quiet renewal
// that comes back here), so a customer never sees an empty guest cart in place of their own.
const cartPage = (req, res, next) => (req.authProblem ? customerPage(req, res, next) : next());
router.get("/cart", cartPage, pages.cart);
router.get("/checkout", customerPage, pages.checkout);
router.get(["/account/orders", "/orders"], accountPage, pages.orders);
router.get(["/account/wallet", "/wallet"], accountPage, pages.wallet);
router.get("/orders/:orderId", accountPage, pages.orderDetail);
router.get("/orders/:orderId/success", customerPage, pages.orderSuccess);
router.get("/orders/:orderId/invoice", customerPage, pages.orderInvoice);

module.exports = router;
