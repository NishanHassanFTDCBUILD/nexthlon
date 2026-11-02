const { CATEGORIES } = require("../config/catalog");

const rupees = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const shortDate = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });

// Values and helper functions every EJS view can use. Set first, so even error pages have them.
function viewLocals(req, res, next) {
  res.locals.currentUser = null;
  res.locals.path = req.path;
  res.locals.query = req.query;
  res.locals.navCategories = CATEGORIES;
  res.locals.formatPrice = value => rupees.format(value || 0);
  res.locals.formatDate = value => (value ? shortDate.format(new Date(value)) : "—");
  res.locals.firstName = name => String(name || "").split(" ")[0];
  // Draws an icon from public/img/icons.svg. Only called with fixed names from the templates.
  res.locals.icon = (name, extraClass = "") =>
    `<svg class="i ${extraClass}" aria-hidden="true" focusable="false"><use href="/img/icons.svg#${name}"></use></svg>`;
  next();
}

module.exports = { viewLocals };
