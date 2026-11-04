const { STORE, PRICE_BANDS } = require("../config/store");
const categoryService = require("../services/categoryService");
const { formatPaise } = require("../utils/money");

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
