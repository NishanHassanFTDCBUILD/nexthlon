const { countItems } = require("../services/cartService");

// Puts the number of items in the customer's cart on every page, for the header cart icon.
// API calls skip this; they return the full cart whenever it changes.
async function cartCount(req, res, next) {
  res.locals.cartCount = 0;
  if (req.method !== "GET" || req.path.startsWith("/api/") || !req.user || req.user.role !== "customer") return next();
  try {
    res.locals.cartCount = await countItems(req.user._id);
    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = { cartCount };
