const router = require('express').Router();
const pages = require('../controllers/pageController');
const account = require('../controllers/accountPageController');
const {customerPage, shopperPage, guestOnly} = require('../middleware/auth');
const {accountShell} = require('../middleware/shell');
const {publicCache} = require('../middleware/publicCache');
const recovery = require('../controllers/recoveryController');

// My Account pages: signed-in customers only, without the store's motion layer.
const accountPage = [customerPage, accountShell];

// Store. For signed-out visitors these pages may be kept by a CDN for a short time
// (middleware/publicCache.js); the cart, checkout and account pages never are.
router.get('/', publicCache, pages.home);
router.get('/products', publicCache, pages.products);
router.get('/products/:slug', publicCache, pages.productDetail);
// The "stop this alert" link in a back-in-stock email (E3).
router.get('/stock-alerts/stop', pages.stopStockAlert);

// Store information and the policies Razorpay asks for
// The page the app shows with no connection (E5, public/sw.js). Kept by the service worker, signed out.
router.get('/offline', publicCache, (req, res) => res.render('pages/offline'));
router.get('/about', publicCache, pages.infoPage('about'));
router.get('/contact', publicCache, pages.infoPage('contact'));
router.get('/track', publicCache, pages.infoPage('track'));
// Styleguide: the design tokens and components, for the team (rendered from the live stylesheets).
// Frequently asked questions: the answers come from config/faq.js.
router.get('/faq', publicCache, (req, res) =>
  res.render('pages/faq', {
    title: 'Frequently asked questions | Nexthlon',
    faqs: require('../config/faq'),
  }),
);
// Shown to the team while developing. On the live store it is not published: the normal 404 page answers.
router.get('/styleguide', publicCache, (req, res, next) => {
  if (require('../config/env').isProduction) return next();
  return res.render('pages/styleguide', {
    title: 'Styleguide | Nexthlon',
    pageKey: 'styleguide',
    topics: [],
  });
});
router.get('/account/gift-card', accountPage, (req, res) =>
  res.render('account/gift-card', {title: 'Gift card | Nexthlon'}),
);
// Find my shoe size (a plain form on the server; no script).
router.get(
  '/find-my-size',
  publicCache,
  require('../controllers/sizeFinderController').sizeFinder,
);
router.get('/privacy', publicCache, pages.infoPage('privacy'));
router.get('/terms', publicCache, pages.infoPage('terms'));
router.get('/refund-policy', publicCache, pages.infoPage('refund'));
router.get('/shipping-policy', publicCache, pages.infoPage('shipping'));

// Customer account
router.get('/login', guestOnly, pages.login);
// The old phone sign-in page: phone codes now live on the sign-in card's "Phone number" tab.
router.get('/sign-in/phone', (req, res) =>
  res.redirect(301, '/login?method=phone'),
);
router.get('/signup', guestOnly, pages.signup);
// Forgotten password and email confirmation. The reset and confirm pages open from the links in emails,
// so they work whether or not someone is signed in.
router.get('/forgot-password', guestOnly, recovery.forgotPage);
router.get('/reset-password', recovery.resetPage);
router.get('/verify-email', recovery.verifyPage);
// My Account. The older short URLs (/profile, /orders, /wallet, /wishlist) still work.
router.get('/account', accountPage, account.overview);
router.get(['/account/addresses', '/profile'], accountPage, pages.profile);
router.get('/account/buy-again', accountPage, account.buyAgain);
router.get('/account/coupons', accountPage, account.coupons);
router.get(['/account/lists', '/wishlist'], accountPage, account.lists);
router.get('/account/recent', accountPage, account.recent);
router.get('/account/security', accountPage, account.security);
router.get('/account/notifications', accountPage, account.notifications);
router.get('/account/referral', accountPage, account.referral);
router.get('/account/help', accountPage, account.help);
router.get('/account/help/:ticketId', accountPage, account.ticket);
router.get('/lists/:shareId', account.sharedList);
// The cart is for signed-in customers: anyone else is sent to sign in and comes back here.
router.get('/cart', shopperPage, pages.cart);
router.get('/checkout', customerPage, pages.checkout);
router.get(['/account/orders', '/orders'], accountPage, pages.orders);
router.get(['/account/wallet', '/wallet'], accountPage, pages.wallet);
router.get('/orders/:orderId', accountPage, pages.orderDetail);
router.get('/orders/:orderId/success', customerPage, pages.orderSuccess);
router.get('/orders/:orderId/invoice', customerPage, pages.orderInvoice);
router.get(
  '/orders/:orderId/credit-notes/:index',
  customerPage,
  pages.orderCreditNote,
);

module.exports = router;
