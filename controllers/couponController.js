const couponService = require("../services/couponService");
const cartService = require("../services/cartService");
const { asyncHandler } = require("../utils/http");

// GET /api/coupons   Coupons this customer can use, measured against their cart.
const listAvailable = asyncHandler(async (req, res) => {
  const cart = await cartService.getCart(req.user._id);
  res.json({ coupons: await couponService.listAvailable(req.user._id, cart.summary.subtotal), applied: cart.couponCode || "" });
});

// POST /api/checkout/coupon   body: { code }   Checked on the server against the live cart.
const apply = asyncHandler(async (req, res) => {
  const cart = await cartService.getCart(req.user._id);
  const coupon = await couponService.applyToCart(req.user._id, req.body && req.body.code, cart.summary.subtotal);
  res.json({ message: `Coupon ${coupon.code} applied.`, coupon });
});

// DELETE /api/checkout/coupon
const remove = asyncHandler(async (req, res) => {
  await couponService.removeFromCart(req.user._id);
  res.json({ message: "Coupon removed." });
});

module.exports = { listAvailable, apply, remove };
