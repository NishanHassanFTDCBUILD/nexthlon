const cartService = require("../services/cartService");
const { validateCartItem, validateCartQuantity, hasErrors } = require("../utils/validators");
const { HttpError, asyncHandler } = require("../utils/http");

function checked(validate, body) {
  const { errors, value } = validate(body);
  if (hasErrors(errors)) throw new HttpError(400, Object.values(errors)[0], errors);
  return value;
}

// GET /api/cart
const getCart = asyncHandler(async (req, res) => {
  res.json({ cart: await cartService.getCart(req.cartOwner) });
});

// GET /api/cart/count   the number on the header badge (guest pages fill it in after loading)
const countItems = asyncHandler(async (req, res) => {
  res.json({ count: await cartService.countItems(req.cartOwner) });
});

// POST /api/cart/items   body: { "productId": "...", "quantity": 1 }
const addItem = asyncHandler(async (req, res) => {
  const { productId, quantity } = checked(validateCartItem, req.body);
  const { product, cart } = await cartService.addItem(req.cartOwner, productId, quantity);
  res.status(201).json({ message: `${product.name} added to your cart.`, cart });
});

// PATCH /api/cart/items/:productId   body: { "quantity": 2 }
const updateItem = asyncHandler(async (req, res) => {
  const { quantity } = checked(validateCartQuantity, req.body);
  const cart = await cartService.updateQuantity(req.cartOwner, req.params.productId, quantity);
  res.json({ message: "Quantity updated.", cart });
});

// DELETE /api/cart/items/:productId
const removeItem = asyncHandler(async (req, res) => {
  const cart = await cartService.removeItem(req.cartOwner, req.params.productId);
  res.json({ message: "Item removed from your cart.", cart });
});

// DELETE /api/cart
const clearCart = asyncHandler(async (req, res) => {
  res.json({ message: "Your cart is now empty.", cart: await cartService.clearCart(req.cartOwner) });
});

module.exports = { getCart, countItems, addItem, updateItem, removeItem, clearCart };
