const wishlistService = require('../services/wishlistService');
const {validateCartItem, hasErrors} = require('../utils/validators');
const {HttpError, asyncHandler} = require('../utils/http');

// GET /api/wishlist
const getWishlist = asyncHandler(async (req, res) => {
  res.json({wishlist: await wishlistService.getWishlist(req.user._id)});
});

// POST /api/wishlist   body: { "productId": "..." }
const addProduct = asyncHandler(async (req, res) => {
  const {errors, value} = validateCartItem({
    productId: req.body && req.body.productId,
  });
  if (hasErrors(errors))
    throw new HttpError(400, errors.productId || 'Choose a product.', errors);
  const {product, wishlist} = await wishlistService.addProduct(
    req.user._id,
    value.productId,
  );
  res
    .status(201)
    .json({message: `${product.name} saved to your wishlist.`, wishlist});
});

// DELETE /api/wishlist/:productId
const removeProduct = asyncHandler(async (req, res) => {
  const wishlist = await wishlistService.removeProduct(
    req.user._id,
    req.params.productId,
  );
  res.json({message: 'Removed from your wishlist.', wishlist});
});

// POST /api/wishlist/:productId/move-to-cart
const moveToCart = asyncHandler(async (req, res) => {
  const {product, cart, wishlist} = await wishlistService.moveToCart(
    req.user._id,
    req.params.productId,
  );
  res.json({message: `${product.name} moved to your cart.`, cart, wishlist});
});

// POST /api/cart/items/:productId/save-for-later
const saveForLater = asyncHandler(async (req, res) => {
  const {cart, wishlist} = await wishlistService.saveForLater(
    req.user._id,
    req.params.productId,
  );
  res.json({message: 'Saved for later in your wishlist.', cart, wishlist});
});

module.exports = {
  getWishlist,
  addProduct,
  removeProduct,
  moveToCart,
  saveForLater,
};
