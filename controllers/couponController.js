const couponService = require('../services/couponService');
const cartService = require('../services/cartService');
const buyNowService = require('../services/buyNowService');
const {asyncHandler, HttpError} = require('../utils/http');
const {couponDiscountFor} = require('../utils/pricing');

// The items a coupon is measured against: the cart, or the Buy now product (?source=buynow or
// body.source). Each keeps its own coupon, so a Buy now coupon never changes the cart's.
async function itemsFor(userId, source) {
  if (source !== 'buynow') return cartService.getCart(userId);
  const view = await buyNowService.getView(userId);
  if (!view) throw new HttpError(410, buyNowService.EXPIRED_MESSAGE);
  return view;
}
const sourceOf = (req) =>
  buyNowService.readSource((req.body && req.body.source) || req.query.source);

// GET /api/coupons   Coupons this customer can use, measured against their cart (or Buy now).
const listAvailable = asyncHandler(async (req, res) => {
  const items = await itemsFor(req.user._id, sourceOf(req));
  res.json({
    coupons: await couponService.listAvailable(
      req.user._id,
      items.summary.subtotal,
    ),
    applied: items.couponCode || '',
  });
});

// POST /api/checkout/coupon   body: { code, source? }   Checked on the server against the live items.
const apply = asyncHandler(async (req, res) => {
  const source = sourceOf(req);
  const items = await itemsFor(req.user._id, source);
  if (source !== 'buynow') {
    const coupon = await couponService.applyToCart(
      req.user._id,
      req.body && req.body.code,
      items.summary.subtotal,
    );
    res.json({message: `Coupon ${coupon.code} applied.`, coupon});
    return;
  }
  // Same checks as the cart, saved on the Buy now product instead.
  const code = couponService.normaliseCode(req.body && req.body.code);
  if (!couponService.CODE.test(code))
    throw new HttpError(400, 'Enter a valid coupon code.', {
      code: 'Enter a valid coupon code.',
    });
  const {coupon, problem} = await couponService.check(
    code,
    req.user._id,
    items.summary.subtotal,
  );
  if (problem) throw new HttpError(400, problem, {code: problem});
  await buyNowService.setCoupon(req.user._id, coupon.code);
  const publicCoupon = couponService.toPublicCoupon(coupon, {
    saving: couponDiscountFor(coupon, items.summary.subtotal),
  });
  res.json({message: `Coupon ${coupon.code} applied.`, coupon: publicCoupon});
});

// DELETE /api/checkout/coupon   (?source=buynow for the Buy now checkout)
const remove = asyncHandler(async (req, res) => {
  if (sourceOf(req) === 'buynow')
    await buyNowService.setCoupon(req.user._id, '');
  else await couponService.removeFromCart(req.user._id);
  res.json({message: 'Coupon removed.'});
});

module.exports = {listAvailable, apply, remove};
