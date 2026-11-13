const router = require("express").Router();
const cart = require("../controllers/cartController");
const { saveForLater } = require("../controllers/wishlistController");
const { requireAuth, requireRole } = require("../middleware/auth");
const { cartOwner } = require("../middleware/guestCart");
const { cartLimiter } = require("../middleware/rateLimit");

// Mounted at /api/cart. Only signed-in customers can put anything in a cart: every change needs a sign-in
// first (the store sends a signed-out visitor to sign in and back to the same page). Reading stays open,
// so a signed-out page can still ask for its badge count (an empty cart). Carts that guests filled before
// this rule move into the account at their next sign-in (cartService.mergeGuestCart).
const customer = [requireAuth, requireRole("customer")];

router.use(cartLimiter);
router.get("/", cartOwner, cart.getCart);
router.get("/count", cartOwner, cart.countItems);
router.delete("/", customer, cartOwner, cart.clearCart);
router.post("/items", customer, cartOwner, cart.addItem);
router.patch("/items/:productId", customer, cartOwner, cart.updateItem);
router.delete("/items/:productId", customer, cartOwner, cart.removeItem);
// "Save for later" moves the item to the wishlist, which belongs to an account.
router.post("/items/:productId/save-for-later", customer, saveForLater);

module.exports = router;
