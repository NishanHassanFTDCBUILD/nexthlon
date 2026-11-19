const router = require('express').Router();
const wishlist = require('../controllers/wishlistController');
const {requireAuth, requireRole} = require('../middleware/auth');

// Mounted at /api/wishlist. Only signed-in customers have a wishlist.
router.use(requireAuth, requireRole('customer'));
router.get('/', wishlist.getWishlist);
router.post('/', wishlist.addProduct);
router.delete('/:productId', wishlist.removeProduct);
router.post('/:productId/move-to-cart', wishlist.moveToCart);

module.exports = router;
