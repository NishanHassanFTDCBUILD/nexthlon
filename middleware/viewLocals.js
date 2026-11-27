const {STORE, PRICE_BANDS} = require('../config/store');
const categoryService = require('../services/categoryService');
const siteSettingsService = require('../services/siteSettingsService');
const {formatPaise} = require('../utils/money');
const {
  srcsetFor,
  sizedUrl,
  gallerySource,
  CARD_SIZES,
} = require('../utils/images');
const config = require('../config/env');
const {assetUrl, styleBundleUrl, moduleImportMap} = require('../utils/assets');

const shortDate = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

// Values and helper functions every EJS view can use. Set first, so even error pages have them.
function viewLocals(req, res, next) {
  res.locals.accountSections = require('../config/accountNav').ACCOUNT_NAV;
  res.locals.orderWorkQueues =
    require('../config/orderWorkQueues').ORDER_WORK_QUEUES;
  res.locals.orderExperience =
    require('../utils/orderExperience').orderExperience;
  res.locals.adminCan = (permission) => {
    const {can, roleOf} = require('../utils/permissions');
    return can(roleOf(req.user || res.locals.currentUser), permission);
  };
  //Initially sets the current user to null.
  res.locals.currentUser = null;
  //Stores the current URL path.
  res.locals.path = req.path;
  //Stores URL query parameters
  res.locals.query = req.query;
  // Filled with the listed categories (from the database) by navCategories below.
  res.locals.navCategories = [];
  // Store details for the footer and policy pages, and price bands for the category menu.
  res.locals.store = STORE;
  // The Google button shows only when the owner has set up Google sign-in (services/googleSignInService.js).
  res.locals.googleSignIn = Boolean(
    config.google.clientId && config.google.clientSecret && config.siteUrl,
  );
  res.locals.facebookSignIn = Boolean(
    config.facebook.appId && config.facebook.appSecret && config.siteUrl,
  );
  // The storefront language (the nx_lang cookie) and its strings (config/strings.js).
  const strings = require('../config/strings');
  res.locals.lang = strings.langFrom(req.cookies && req.cookies.nx_lang);
  res.locals.t = strings.translator(res.locals.lang);
  // The admin's shopper settings: announcement bar, home sections, reviews, questions, alerts.
  res.locals.site = siteSettingsService.current();
  res.locals.priceBands = PRICE_BANDS;
  // Money is stored in paise: 12345600 shows as ₹1,23,456.
  res.locals.formatPrice = formatPaise;
  //Converts dates into readable format.
  res.locals.formatDate = (value) =>
    value ? shortDate.format(new Date(value)) : '—';
  //Extracts the first name using split(" ")[0].
  res.locals.firstName = (name) => String(name || '').split(' ')[0];
  // Responsive photo sizes for product cards (utils/images.js).
  res.locals.srcsetFor = srcsetFor;
  res.locals.cardSizes = CARD_SIZES;
  res.locals.sizedUrl = sizedUrl;
  res.locals.gallerySource = gallerySource;
  // Where uploaded photos are served from when they live in a bucket ("" on local disk), for preconnect.
  res.locals.storageOrigin = config.storage.origin;
  res.locals.razorpayTestMode =
    config.razorpay.enabled && config.razorpay.keyId.startsWith('rzp_test_');
  // Analytics settings for the consent banner (public/js/consent.js). Nothing secret: the IDs are public.
  res.locals.analytics = config.analytics;
  res.locals.metaPixel = config.metaPixel;
  // Versioned URL for the site's own CSS and JS (utils/assets.js): asset("/css/style.css").
  res.locals.asset = assetUrl;
  // One stylesheet request for a page: styleBundle(["tokens", "components", ...]).
  res.locals.styleBundle = styleBundleUrl;
  res.locals.moduleImportMap = moduleImportMap;
  // Draws an icon from public/img/icons.svg. Only called with fixed names from the templates.
  res.locals.icon = (name, extraClass = '') =>
    `<svg class="i ${extraClass}" aria-hidden="true" focusable="false"><use href="/img/icons.svg#${name}"></use></svg>`;
  next();
}

// The listed categories for the header, menus and footer. Only page requests need them.
async function navCategories(req, res, next) {
  if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
  try {
    res.locals.navCategories = await categoryService.listedCategories();
  } catch {
    res.locals.navCategories = [];
  }
  return next();
}

module.exports = {viewLocals, navCategories};
