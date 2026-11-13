const { countItems } = require("../services/cartService");
const wishlistService = require("../services/wishlistService");

// Puts the number of items in the cart and wishlist on every page, for the header badges.
// Customers: their account's cart and wishlist. Guests: filled in after the page loads (see below).
// API calls skip this; they return the full cart or wishlist whenever it changes.
async function cartCount(req, res, next) {
  res.locals.cartCount = 0;
  res.locals.wishIds = [];
  if (req.method !== "GET" || req.path.startsWith("/api/")) return next();
  try {
    if (req.user && req.user.role === "customer") {
      [res.locals.cartCount, res.locals.wishIds] = await Promise.all([
        countItems(req.user._id),
        wishlistService.productIds(req.user._id)
      ]);
    }
    // Guests: the page is drawn with an empty badge, so it is the same for every guest and a CDN may keep
    // it (middleware/publicCache.js); store.js fills the badge in from GET /api/cart/count.
    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = { cartCount };
