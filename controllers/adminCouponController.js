// The admin coupon API. Every change is written to the audit log, because a coupon is money.
const adminCouponService = require('../services/adminCouponService');
const auditService = require('../services/auditService');
const {validateCoupon, hasErrors} = require('../utils/validators');
const {HttpError, asyncHandler} = require('../utils/http');

// What goes in the audit log: the fields that matter, never anything secret.
const snapshot = (coupon) => ({
  code: coupon.code,
  type: coupon.type,
  value: coupon.value,
  minOrder: coupon.minOrder,
  maxDiscount: coupon.maxDiscount,
  usageLimit: coupon.usageLimit,
  perUserLimit: coupon.perUserLimit,
  startsAt: coupon.startsAt,
  endsAt: coupon.endsAt,
  isActive: coupon.isActive,
});

function checked(body) {
  const {errors, value} = validateCoupon(body);
  if (hasErrors(errors))
    throw new HttpError(400, 'Please fix the highlighted fields.', errors);
  return value;
}

// GET /api/admin/coupons?q=&status=&sort=&page=
const listCoupons = asyncHandler(async (req, res) => {
  res.json(await adminCouponService.listCoupons(req.query));
});

// GET /api/admin/coupons/:couponId
const getCoupon = asyncHandler(async (req, res) => {
  res.json(await adminCouponService.getCouponDetail(req.params.couponId));
});

// POST /api/admin/coupons
const createCoupon = asyncHandler(async (req, res) => {
  const coupon = await adminCouponService.createCoupon(checked(req.body));
  await auditService.record({
    ...auditService.fromRequest(req),
    action: 'coupon.created',
    target: `coupon:${coupon.id}`,
    after: snapshot(coupon),
  });
  res
    .status(201)
    .json({message: `Coupon ${coupon.code} has been created.`, coupon});
});

// PATCH /api/admin/coupons/:couponId
const updateCoupon = asyncHandler(async (req, res) => {
  const before = await adminCouponService.getCoupon(req.params.couponId);
  const coupon = await adminCouponService.updateCoupon(
    req.params.couponId,
    checked(req.body),
  );
  await auditService.record({
    ...auditService.fromRequest(req),
    action: 'coupon.updated',
    target: `coupon:${coupon.id}`,
    before: snapshot(before),
    after: snapshot(coupon),
  });
  res.json({message: `Coupon ${coupon.code} has been saved.`, coupon});
});

// PATCH /api/admin/coupons/:couponId/active   body: { "isActive": false }
const setActive = asyncHandler(async (req, res) => {
  const {isActive} = req.body || {};
  if (typeof isActive !== 'boolean')
    throw new HttpError(400, 'isActive must be true or false.');
  const coupon = await adminCouponService.setActive(
    req.params.couponId,
    isActive,
  );
  await auditService.record({
    ...auditService.fromRequest(req),
    action: isActive ? 'coupon.enabled' : 'coupon.disabled',
    target: `coupon:${coupon.id}`,
    after: {code: coupon.code, isActive},
  });
  res.json({
    message: isActive
      ? `Coupon ${coupon.code} is live again.`
      : `Coupon ${coupon.code} has been disabled.`,
    coupon,
  });
});

// DELETE /api/admin/coupons/:couponId   (a soft delete: the redemption history is kept)
const deleteCoupon = asyncHandler(async (req, res) => {
  const coupon = await adminCouponService.deleteCoupon(req.params.couponId);
  await auditService.record({
    ...auditService.fromRequest(req),
    action: 'coupon.deleted',
    target: `coupon:${coupon.id}`,
    before: snapshot(coupon),
  });
  res.json({
    message: `Coupon ${coupon.code} has been deleted. Orders that used it keep their history.`,
    coupon,
  });
});

module.exports = {
  listCoupons,
  getCoupon,
  createCoupon,
  updateCoupon,
  setActive,
  deleteCoupon,
};
