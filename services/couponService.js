// Coupons: checking a code, keeping the chosen one on the cart, listing the ones a customer can
// use, and counting each use. The discount itself is worked out in utils/pricing.js.
//   usedCount on the coupon    the total-uses limit, claimed with ONE atomic update
//   CouponRedemption rows      the per-customer limit, one row per order that used it
const mongoose = require('mongoose');
const Cart = require('../models/Cart');
const Coupon = require('../models/Coupon');
const CouponRedemption = require('../models/CouponRedemption');
const {HttpError} = require('../utils/http');
const {formatPaise} = require('../utils/money');
const {couponProblem, couponDiscountFor} = require('../utils/pricing');

const CODE = /^[A-Z0-9]{3,20}$/;
const UNDER_LIMIT = {
  $or: [{usageLimit: 0}, {$expr: {$lt: ['$usedCount', '$usageLimit']}}],
};

function normaliseCode(raw) {
  return typeof raw === 'string' ? raw.replace(/\s+/g, '').toUpperCase() : '';
}

// "10% off up to ₹500 on orders over ₹1,999"
function describe(coupon) {
  const off =
    coupon.type === 'percent'
      ? `${coupon.value}% off${coupon.maxDiscount ? ` up to ${formatPaise(coupon.maxDiscount)}` : ''}`
      : `${formatPaise(coupon.value)} off`;
  return coupon.minOrder
    ? `${off} on orders over ${formatPaise(coupon.minOrder)}`
    : off;
}

function toPublicCoupon(coupon, {problem = null, saving = 0} = {}) {
  return {
    code: coupon.code,
    title: describe(coupon),
    description: coupon.description || '',
    type: coupon.type,
    value: coupon.value,
    maxDiscount: coupon.maxDiscount,
    minOrder: coupon.minOrder,
    endsAt: coupon.endsAt,
    eligible: !problem,
    problem,
    saving,
  };
}

async function usedBy(couponId, userId, session = null) {
  return CouponRedemption.countDocuments({
    coupon: couponId,
    user: userId,
  }).session(session);
}

// Checks a code for this customer and subtotal. Returns { coupon, problem }.
async function check(code, userId, subtotal, now = new Date()) {
  const clean = normaliseCode(code);
  // A deleted coupon behaves exactly like a code that never existed.
  const coupon = CODE.test(clean)
    ? await Coupon.findOne({code: clean, isDeleted: {$ne: true}}).lean()
    : null;
  if (!coupon) return {coupon: null, problem: 'This coupon code is not valid.'};
  const problem = couponProblem(coupon, {
    subtotal,
    usedByUser: await usedBy(coupon._id, userId),
    now,
  });
  return {coupon, problem};
}

// Chooses a coupon for checkout. The code is checked now and again whenever totals are worked out.
async function applyToCart(userId, rawCode, subtotal) {
  const code = normaliseCode(rawCode);
  if (!CODE.test(code))
    throw new HttpError(400, 'Enter a valid coupon code.', {
      code: 'Enter a valid coupon code.',
    });
  if (!(subtotal > 0)) throw new HttpError(400, 'Your cart is empty.');
  const {coupon, problem} = await check(code, userId, subtotal);
  if (problem) throw new HttpError(400, problem, {code: problem});
  await Cart.updateOne({user: userId}, {$set: {couponCode: coupon.code}});
  return toPublicCoupon(coupon, {saving: couponDiscountFor(coupon, subtotal)});
}

async function removeFromCart(userId) {
  await Cart.updateOne({user: userId}, {$set: {couponCode: ''}});
}

// Coupons this customer could use now: running, not used up, and not used up by them.
// Ones that need a bigger order are listed too, with what is missing.
async function listAvailable(userId, subtotal, now = new Date()) {
  const coupons = await Coupon.find({
    isActive: true,
    isDeleted: {$ne: true},
    $and: [
      {$or: [{startsAt: null}, {startsAt: {$lte: now}}]},
      {$or: [{endsAt: null}, {endsAt: {$gte: now}}]},
      UNDER_LIMIT,
    ],
  })
    .sort({minOrder: 1, createdAt: -1})
    .limit(20)
    .lean();
  if (!coupons.length) return [];
  const counts = await CouponRedemption.aggregate([
    {
      $match: {
        user: new mongoose.Types.ObjectId(String(userId)),
        coupon: {$in: coupons.map((coupon) => coupon._id)},
      },
    },
    {$group: {_id: '$coupon', used: {$sum: 1}}},
  ]);
  const usedOf = (id) =>
    (counts.find((row) => String(row._id) === String(id)) || {used: 0}).used;
  return coupons
    .filter(
      (coupon) =>
        !(coupon.perUserLimit > 0 && usedOf(coupon._id) >= coupon.perUserLimit),
    )
    .map((coupon) => {
      const problem = couponProblem(coupon, {
        subtotal,
        usedByUser: usedOf(coupon._id),
        now,
      });
      return toPublicCoupon(coupon, {
        problem,
        saving: problem ? 0 : couponDiscountFor(coupon, subtotal),
      });
    })
    .sort(
      (a, b) => Number(b.eligible) - Number(a.eligible) || b.saving - a.saving,
    );
}

// Counts one use of the coupon for this order. Runs inside the order's transaction (session),
// or registers undo steps on a single server.
async function redeem(
  coupon,
  userId,
  orderObjectId,
  discount,
  {session = null, undo = null} = {},
) {
  const claimed = await Coupon.findOneAndUpdate(
    {_id: coupon._id, isActive: true, isDeleted: {$ne: true}, ...UNDER_LIMIT},
    {$inc: {usedCount: 1}},
    {new: true, session},
  );
  if (!claimed)
    throw new HttpError(
      409,
      `Coupon ${coupon.code} has just run out. Remove it to continue.`,
    );
  if (undo)
    undo(() => Coupon.updateOne({_id: coupon._id}, {$inc: {usedCount: -1}}));
  await CouponRedemption.create(
    [
      {
        coupon: coupon._id,
        user: userId,
        order: orderObjectId,
        code: coupon.code,
        discount,
      },
    ],
    {session},
  );
  if (undo) undo(() => CouponRedemption.deleteOne({order: orderObjectId}));
  if (
    claimed.perUserLimit > 0 &&
    (await usedBy(coupon._id, userId, session)) > claimed.perUserLimit
  ) {
    throw new HttpError(409, 'You have already used this coupon.');
  }
}

// Gives the use back when the order is cancelled or never paid.
async function release(orderObjectId) {
  const row = await CouponRedemption.findOneAndDelete({order: orderObjectId});
  if (row)
    await Coupon.updateOne(
      {_id: row.coupon, usedCount: {$gt: 0}},
      {$inc: {usedCount: -1}},
    );
  return Boolean(row);
}

module.exports = {
  CODE,
  normaliseCode,
  describe,
  toPublicCoupon,
  usedBy,
  check,
  applyToCart,
  removeFromCart,
  listAvailable,
  redeem,
  release,
};
