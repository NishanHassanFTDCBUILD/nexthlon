const { STORE, PRICE_BANDS } = require("../config/store");
const categoryService = require("../services/categoryService");
const { formatPaise } = require("../utils/money");
const { srcsetFor, sizedUrl, gallerySource, CARD_SIZES } = require("../utils/images");
const config = require("../config/env");
const { assetUrl, styleBundleUrl } = require("../utils/assets");

const shortDate = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });

// Values and helper functions every EJS view can use. Set first, so even error pages have them.
function viewLocals(req, res, next) {
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
  res.locals.priceBands = PRICE_BANDS;
  // Money is stored in paise: 12345600 shows as ₹1,23,456.
  res.locals.formatPrice = formatPaise;
  //Converts dates into readable format.
  res.locals.formatDate = value => (value ? shortDate.format(new Date(value)) : "—");
  //Extracts the first name using split(" ")[0].
  res.locals.firstName = name => String(name || "").split(" ")[0];
  // Responsive photo sizes for product cards (utils/images.js).
  res.locals.srcsetFor = srcsetFor;
  res.locals.cardSizes = CARD_SIZES;
  res.locals.sizedUrl = sizedUrl;
  res.locals.gallerySource = gallerySource;
  // Where uploaded photos are served from when they live in a bucket ("" on local disk), for preconnect.
  res.locals.storageOrigin = config.storage.origin;
  res.locals.razorpayTestMode = config.razorpay.enabled && config.razorpay.keyId.startsWith("rzp_test_");
  // Analytics settings for the consent banner (public/js/consent.js). Nothing secret: the IDs are public.
  res.locals.analytics = config.analytics;
  res.locals.metaPixel = config.metaPixel;
  // "Chat on WhatsApp" (E1): a wa.me link to the support number, or "" when none is set.
  res.locals.whatsappChat = config.messaging.supportNumber ? `https://wa.me/${config.messaging.supportNumber}` : "";
  // Versioned URL for the site's own CSS and JS (utils/assets.js): asset("/css/style.css").
  res.locals.asset = assetUrl;
  // One stylesheet request for a page: styleBundle(["tokens", "components", ...]).
  res.locals.styleBundle = styleBundleUrl;
  // Draws an icon from public/img/icons.svg. Only called with fixed names from the templates.
  res.locals.icon = (name, extraClass = "") =>
    `<svg class="i ${extraClass}" aria-hidden="true" focusable="false"><use href="/img/icons.svg#${name}"></use></svg>`;
  next();
}

// The listed categories for the header, menus and footer. Only page requests need them.
async function navCategories(req, res, next) {
  if (req.method !== "GET" || req.path.startsWith("/api/")) return next();
  try {
    res.locals.navCategories = await categoryService.listedCategories();
  } catch {
    res.locals.navCategories = [];
  }
  return next();
}

module.exports = { viewLocals, navCategories };
