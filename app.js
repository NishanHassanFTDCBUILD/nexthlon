const path = require('path');
const express = require('express');
const compression = require('compression');
//. It sets various HTTP security
// headers to help protect our website against common browser-based attacks.
const helmet = require('helmet');
//Load the tool that reads cookies into req.cookies. We need it to read the JWT cookie.
const cookieParser = require('cookie-parser');
const config = require('./config/env');
const {viewLocals, navCategories} = require('./middleware/viewLocals');
const {attachUser} = require('./middleware/auth');
const {cartCount} = require('./middleware/cartCount');
const {originCheck} = require('./middleware/originCheck');
const {noCache} = require('./middleware/noCache');
const {notFound, errorHandler} = require('./middleware/errorHandler');
const {requestId} = require('./middleware/requestId');
// What the job worker and the event system can do (order emails, cart reminders). Registered before any
// order code can say "this happened".
require('./jobs/handlers');
// With Redis (REDIS_URL), a cleared catalogue cache is cleared on every copy of the store at once.
require('./services/cacheSync').start();

const app = express();
//Hide the header that says "Express", so attackers learn less. This reveals less technology information to attackers.
app.disable('x-powered-by');
// How many proxies sit in front of the app (TRUST_PROXY). Behind a hosting platform this is what makes
// req.ip the visitor's address instead of the platform's, so each visitor gets their own rate limit,
// and req.protocol "https", so Secure cookies work. Trusting too many would let a visitor fake an address.
app.set('trust proxy', config.trustProxy);
// First of all: every request gets an ID, carried through the logs, error alerts and the error page.
app.use(requestId);
// Liveness and readiness for the hosting platform (before the heavier middleware, no login needed).
app.use(require('./routes/healthRoutes'));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Security headers. The Content Security Policy only allows our own scripts and styles,
// Google Fonts, product photos from Unsplash, and exactly what Razorpay Checkout needs.
// Analytics hosts are only in the policy when a provider is set up (utils/analytics.js).
const analyticsHostsBase = require('./utils/analytics').cspHosts(
  config.analytics,
);
const metaHosts = require('./utils/analytics').metaHosts(config.metaPixel);
const analyticsHosts = {
  script: [...analyticsHostsBase.script, ...metaHosts.script],
  connect: [...analyticsHostsBase.connect, ...metaHosts.connect],
  img: [...analyticsHostsBase.img, ...metaHosts.img],
};
app.use(
  helmet({
    //enables CSP configuration
    contentSecurityPolicy: {
      //contains rules that control where different resources can come from.
      directives: {
        'default-src': ["'self'"],
        // checkout.razorpay.com serves checkout.js; it then loads its fraud-check script
        // (razorpay-risk-detection) from cdn.razorpay.com. Blocking that script breaks payments.
        'script-src': [
          "'self'",
          'https://checkout.razorpay.com',
          'https://cdn.razorpay.com',
          ...analyticsHosts.script,
        ],
        // Razorpay Checkout opens in its own frame.
        'frame-src': [
          'https://api.razorpay.com',
          'https://checkout.razorpay.com',
        ],
        'style-src': ["'self'", "'unsafe-inline'"],
        // Fonts are served from this site (public/fonts), so nothing comes from Google.
        'font-src': ["'self'"],
        // Product videos come from the photo bucket's address, like photos (see img-src).
        'media-src': [
          "'self'",
          'blob:',
          'https:',
          ...(config.storage.origin ? [config.storage.origin] : []),
        ],
        // Photos: this site, Unsplash (the sample products), Razorpay's logo, and the photo bucket's address.
        'img-src': [
          "'self'",
          'data:',
          'blob:',
          'https://images.unsplash.com',
          'https://cdn.razorpay.com',
          ...(config.storage.origin ? [config.storage.origin] : []),
          ...analyticsHosts.img,
        ],
        //Controls where JavaScript can connect to fetch data.
        'connect-src': [
          "'self'",
          'https://api.razorpay.com',
          'https://lumberjack.razorpay.com',
          'https://lumberjack-cx.razorpay.com',
          'https://cdn.razorpay.com',
          ...analyticsHosts.connect,
        ],
        //Controls where HTML forms are allowed to submit data. Razorpay posts to its own API when a
        // bank page has to open in a new window and the browser blocks the pop-up.
        'form-action': ["'self'", 'https://api.razorpay.com'],
        //Controls whether another website can embed Nexthlon inside an iframe.
        'frame-ancestors': ["'none'"],
        //"Upgrade-insecure-requests is enabled only in production. It instructs the browser to upgrade insecure HTTP resource requests to HTTPS, improving transport security."
        'upgrade-insecure-requests': config.isProduction ? [] : null,
      },
    },
    // Razorpay opens netbanking, wallet and card-authentication (3-D Secure / OTP) pages in a
    // pop-up and then fills it in. helmet's default "same-origin" cuts the page off from any
    // pop-up on another site, so the pop-up stayed about:blank and the payment failed.
    // "same-origin-allow-popups" keeps that link for pop-ups this page opens, and still keeps
    // other sites that open Nexthlon from reaching into it.
    crossOriginOpenerPolicy: {policy: 'same-origin-allow-popups'},
    // Send only our origin (never the full URL) to other sites. Razorpay checks which website a
    // payment comes from; "no-referrer" (helmet's default) hides even that.
    referrerPolicy: {policy: 'strict-origin-when-cross-origin'},
  }),
);

// gzip every text reply (pages, CSS, JS, JSON, SVG): about 70% less to download, which is the
// biggest single speed-up on phones. Images and fonts are already compressed, so they are skipped.
app.use(compression());

// Caching for files in public/:
// - CSS and JS linked from a page carry ?v=<content hash> (utils/assets.js), so the browser keeps
//   them for a year without asking again. A changed file gets a new URL, so updates still arrive.
// - The same files without ?v= (ES module imports, scripts that load other files) are re-checked
//   on every visit: a quick 304 when unchanged, and never a stale mix after a release.
// - Images and fonts keep a week in production (uploads have random names; fonts never change).
const ONE_YEAR = 365 * 24 * 60 * 60;
// Each page's stylesheets joined into one request (utils/assets.js).
app.get('/css/bundle.css', require('./utils/assets').serveStyleBundle);
app.use(
  express.static(path.join(__dirname, 'public'), {
    setHeaders(res, filePath) {
      if (res.req && res.req.query && res.req.query.v) {
        res.setHeader(
          'Cache-Control',
          `public, max-age=${ONE_YEAR}, immutable`,
        );
      } else if (/\.(css|js|mjs)$/.test(filePath)) {
        res.setHeader('Cache-Control', 'no-cache');
      } else {
        res.setHeader(
          'Cache-Control',
          config.isProduction ? 'public, max-age=604800' : 'public, max-age=0',
        );
      }
    },
  }),
);
// Everything after the static files (API replies, EJS pages, error pages) is never cached.
// Static files are served above, so CSS, JS and images keep their normal caching.
app.use(noCache);
// The Razorpay webhook needs the exact raw body to check its signature, so it is mounted before
// the JSON parser. It is also before the origin check: Razorpay's servers send no Origin header,
// and the signature is the proof it really came from Razorpay.
app.post(
  '/api/payments/razorpay/webhook',
  express.raw({type: 'application/json', limit: '1mb'}),
  require('./controllers/paymentController').webhook,
);
// Courier tracking updates (B5): no Origin header either; the x-api-key token proves where they come from.
// Its own size limit, because a parcel's full scan list can be bigger than a normal API request.
app.post(
  '/api/webhooks/marketplace-stock',
  express.json({limit: '16kb'}),
  require('./controllers/marketplaceController').stockSync,
);
app.post(
  '/api/webhooks/courier',
  express.json({limit: '256kb'}),
  require('./controllers/shippingController').courierWebhook,
);
app.use(express.json({limit: '20kb'}));
app.use(express.urlencoded({extended: false, limit: '20kb'}));
app.use(cookieParser());
app.use(viewLocals);
app.use(attachUser);
app.use(cartCount);
app.use(navCategories);
// Canonical address, link-preview defaults and noindex on private pages (middleware/seo.js).
app.use(require('./middleware/seo').seoDefaults);

// JSON API
app.get('/api/health', (req, res) =>
  res.json({status: 'ok', app: 'Nexthlon API'}),
);
app.use('/api', originCheck);
app.use('/api', require('./routes/authRoutes'));
app.use('/api', require('./routes/productRoutes'));
// "Ask Nexthlon": the shopping assistant (services/shoppingAssistantService.js).
app.use('/api/assistant', require('./routes/assistantRoutes'));
app.use('/api/profile', require('./routes/profileRoutes'));
app.use('/api/push', require('./routes/pushRoutes'));
app.use('/api', require('./routes/bundleRoutes'));
app.use(require('./routes/guideRoutes'));
app.use('/api/addresses', require('./routes/addressRoutes'));
app.use('/api/cart', require('./routes/cartRoutes'));
app.use('/api/wishlist', require('./routes/wishlistRoutes'));
// Browsers ask for /favicon.ico by themselves; the page's own icon is the SVG.
app.get('/favicon.ico', (req, res) => res.redirect(301, '/img/favicon.svg'));
app.use('/api/account', require('./routes/accountRoutes'));
app.use('/api/lists', require('./routes/listRoutes'));
app.use('/api/support', require('./routes/supportRoutes'));
app.use('/api', require('./routes/orderRoutes'));
app.use('/api', require('./routes/walletRoutes'));
app.use('/api/payments', require('./routes/paymentRoutes'));
app.use('/api', require('./routes/contactRoutes'));
app.use('/api/admin', require('./routes/adminRoutes'));

// EJS pages. The admin console lives at its private path (ADMIN_PATH); /admin is just a 404
// when another path is set.
app.use(config.adminPath, require('./routes/adminPageRoutes'));
// robots.txt and sitemap.xml for search engines (D1).
app.use('/', require('./routes/seoRoutes'));
// Store previews do not revoke admin sessions. Store and console authentication
// use separate cookies and audiences; only an explicit logout ends either session.
app.use('/', require('./routes/pageRoutes'));

app.use(notFound);
app.use(errorHandler);

module.exports = app;
