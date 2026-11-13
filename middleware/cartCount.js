const { countItems } = require("../services/cartService");
const wishlistService = require("../services/wishlistService");
const { readGuestCart } = require("./guestCart");

// Puts the number of items in the cart and wishlist on every page, for the header badges.
// Customers: their account's cart and wishlist. Guests: the cart kept by their cookie (no wishlist).
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
    } else if (!req.user) {
      const guest = readGuestCart(req);
      if (guest) res.locals.cartCount = await countItems({ guest });
    }
    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = { cartCount };
