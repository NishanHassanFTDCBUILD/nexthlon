const router = require("express").Router();
const cart = require("../controllers/cartController");
const { saveForLater } = require("../controllers/wishlistController");
const { requireAuth, requireRole } = require("../middleware/auth");
const { cartOwner } = require("../middleware/guestCart");
const { cartLimiter } = require("../middleware/rateLimit");

// Mounted at /api/cart. Signed-in customers use their account's cart; guests use a cart kept by a
// cookie, which moves into the account when they sign in (middleware/guestCart.js). Checkout and the
// wishlist still need an account.
router.use(cartLimiter, cartOwner);
router.get("/", cart.getCart);
router.get("/count", cart.countItems);
router.delete("/", cart.clearCart);
router.post("/items", cart.addItem);
router.patch("/items/:productId", cart.updateItem);
router.delete("/items/:productId", cart.removeItem);
// "Save for later" moves the item to the wishlist, which belongs to an account.
router.post("/items/:productId/save-for-later", requireAuth, requireRole("customer"), saveForLater);

module.exports = router;
