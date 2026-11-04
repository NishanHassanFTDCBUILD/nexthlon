const { countItems } = require("../services/cartService");
const wishlistService = require("../services/wishlistService");

// Puts the number of items in the customer's cart and wishlist on every page, for the header badges.
// API calls skip this; they return the full cart or wishlist whenever it changes.
async function cartCount(req, res, next) {
  res.locals.cartCount = 0;
  res.locals.wishIds = [];
  if (req.method !== "GET" || req.path.startsWith("/api/") || !req.user || req.user.role !== "customer") return next();
  try {
    [res.locals.cartCount, res.locals.wishIds] = await Promise.all([
      countItems(req.user._id),
      wishlistService.productIds(req.user._id)
    ]);
    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = { cartCount };
