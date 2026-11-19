// Coupons, from the admin's side: the list, creating and editing, the enable/disable toggle,
// the soft delete, and who used each one.
//
// The rules a coupon is judged by live in utils/pricing.js (couponProblem) and are applied at
// checkout by services/couponService.js. Nothing here duplicates them: the store always decides
// on the server, so an admin screen can never make a coupon behave differently from checkout.
const mongoose = require('mongoose');
const Coupon = require('../models/Coupon');
const CouponRedemption = require('../models/CouponRedemption');
const Order = require('../models/Order');
const {HttpError} = require('../utils/http');
const {escapeRegex, toPositiveInt} = require('./productService');
const {describe} = require('./couponService');

const PAGE_SIZE = 20;
const STATUSES = [
  'all',
  'active',
  'scheduled',
  'expired',
  'disabled',
  'used_up',
];
const STATUS_LABELS = {
  all: 'All',
  active: 'Running now',
  scheduled: 'Starts later',
  expired: 'Expired',
  disabled: 'Disabled',
  used_up: 'Fully used',
};
const SORTS = {
  newest: {label: 'Newest first', order: {createdAt: -1}},
  oldest: {label: 'Oldest first', order: {createdAt: 1}},
  code_asc: {label: 'Code: A to Z', order: {code: 1}},
  used_desc: {label: 'Most used', order: {usedCount: -1, createdAt: -1}},
  ending: {label: 'Expiring soonest', order: {endsAt: 1, createdAt: -1}},
};
// Only coupons that have not been soft-deleted are ever listed.
const LIVE = {isDeleted: {$ne: true}};

// One word for the state an admin cares about, worked out in the same order the store checks it.
function statusOf(coupon, now = new Date()) {
  if (!coupon.isActive) return 'disabled';
  if (coupon.endsAt && now > new Date(coupon.endsAt)) return 'expired';
  if (coupon.startsAt && now < new Date(coupon.startsAt)) return 'scheduled';
  if (coupon.usageLimit > 0 && coupon.usedCount >= coupon.usageLimit)
    return 'used_up';
  return 'active';
}

// Money stays in paise; the *Rupees copies fill the form, which works in rupees.
// The ISO days fill the date inputs.
function toAdminCoupon(coupon, now = new Date()) {
  const day = (date) => (date ? new Date(date).toISOString().slice(0, 10) : '');
  return {
    id: String(coupon._id),
    code: coupon.code,
    description: coupon.description || '',
    title: describe(coupon),
    type: coupon.type,
    value: coupon.value,
    valueRupees: coupon.type === 'flat' ? coupon.value / 100 : coupon.value,
    maxDiscount: coupon.maxDiscount || 0,
    maxDiscountRupees: (coupon.maxDiscount || 0) / 100,
    minOrder: coupon.minOrder || 0,
    minOrderRupees: (coupon.minOrder || 0) / 100,
    startsAt: coupon.startsAt || null,
    endsAt: coupon.endsAt || null,
    startsDay: day(coupon.startsAt),
    endsDay: day(coupon.endsAt),
    usageLimit: coupon.usageLimit || 0,
    perUserLimit: coupon.perUserLimit || 0,
    usedCount: coupon.usedCount || 0,
    // How many uses are left, or null when there is no total limit.
    usesLeft:
      coupon.usageLimit > 0
        ? Math.max(coupon.usageLimit - (coupon.usedCount || 0), 0)
        : null,
    isActive: coupon.isActive !== false,
    status: statusOf(coupon, now),
    createdAt: coupon.createdAt,
    updatedAt: coupon.updatedAt,
  };
}

function readFilters(query = {}) {
  return {
    q: typeof query.q === 'string' ? query.q.trim().slice(0, 40) : '',
    status: STATUSES.includes(query.status) ? query.status : 'all',
    sort: Object.hasOwn(SORTS, query.sort) ? query.sort : 'newest',
    page: toPositiveInt(query.page, 1),
  };
}

// The status filter as a database query, so paging and counting stay correct.
function statusFilter(status, now) {
  const running = [
    {isActive: true},
    {$or: [{startsAt: null}, {startsAt: {$lte: now}}]},
    {$or: [{endsAt: null}, {endsAt: {$gte: now}}]},
    {$or: [{usageLimit: 0}, {$expr: {$lt: ['$usedCount', '$usageLimit']}}]},
  ];
  if (status === 'disabled') return {isActive: false};
  if (status === 'expired')
    return {isActive: true, endsAt: {$ne: null, $lt: now}};
  if (status === 'scheduled')
    return {
      isActive: true,
      startsAt: {$ne: null, $gt: now},
      $or: [{endsAt: null}, {endsAt: {$gte: now}}],
    };
  if (status === 'used_up')
    return {
      isActive: true,
      usageLimit: {$gt: 0},
      $expr: {$gte: ['$usedCount', '$usageLimit']},
    };
  if (status === 'active') return {$and: running};
  return {};
}

async function listCoupons(query = {}, now = new Date()) {
  const filters = readFilters(query);
  const filter = {...LIVE, ...statusFilter(filters.status, now)};
  if (filters.q) {
    const pattern = new RegExp(escapeRegex(filters.q), 'i');
    filter.$and = [
      ...(filter.$and || []),
      {$or: [{code: pattern}, {description: pattern}]},
    ];
  }
  const [rows, total, counts, given] = await Promise.all([
    Coupon.find(filter)
      .sort(SORTS[filters.sort].order)
      .skip((filters.page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .lean(),
    Coupon.countDocuments(filter),
    Coupon.find(LIVE)
      .select('isActive startsAt endsAt usageLimit usedCount')
      .lean(),
    // How much discount every coupon has given altogether.
    CouponRedemption.aggregate([
      {$group: {_id: null, discount: {$sum: '$discount'}, uses: {$sum: 1}}},
    ]),
  ]);
  const tally = {
    all: counts.length,
    active: 0,
    scheduled: 0,
    expired: 0,
    disabled: 0,
    used_up: 0,
  };
  counts.forEach((coupon) => {
    tally[statusOf(coupon, now)] += 1;
  });
  return {
    coupons: rows.map((coupon) => toAdminCoupon(coupon, now)),
    filters,
    sorts: SORTS,
    statusLabels: STATUS_LABELS,
    totals: {
      ...tally,
      discountGiven: given[0] ? given[0].discount : 0,
      uses: given[0] ? given[0].uses : 0,
    },
    pagination: {
      page: filters.page,
      pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
      total,
      limit: PAGE_SIZE,
    },
  };
}

async function findCoupon(couponId) {
  if (!mongoose.isValidObjectId(couponId))
    throw new HttpError(404, 'Coupon not found.');
  const coupon = await Coupon.findOne({_id: couponId, ...LIVE});
  if (!coupon) throw new HttpError(404, 'Coupon not found.');
  return coupon;
}

async function getCoupon(couponId) {
  return toAdminCoupon(await findCoupon(couponId));
}

// The detail page: the coupon, who used it and on which order, and the total discount given.
// One page of uses at a time (?page=), newest first.
async function getCouponDetail(couponId, query = {}) {
  const coupon = await findCoupon(couponId);
  const page = toPositiveInt(query.page, 1);
  const [rows, totals] = await Promise.all([
    CouponRedemption.find({coupon: coupon._id})
      .sort({createdAt: -1})
      .skip((page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .populate('user', 'name email')
      .lean(),
    CouponRedemption.aggregate([
      {$match: {coupon: coupon._id}},
      {
        $group: {
          _id: null,
          discount: {$sum: '$discount'},
          uses: {$sum: 1},
          customers: {$addToSet: '$user'},
        },
      },
    ]),
  ]);
  // The order number for each use, so the admin can open the order.
  const orders = await Order.find({_id: {$in: rows.map((row) => row.order)}})
    .select('orderId orderStatus total walletUsed')
    .lean();
  const orderOf = new Map(orders.map((order) => [String(order._id), order]));
  const summary = totals[0] || {discount: 0, uses: 0, customers: []};
  return {
    coupon: toAdminCoupon(coupon),
    uses: rows.map((row) => {
      const order = orderOf.get(String(row.order));
      return {
        at: row.createdAt,
        discount: row.discount,
        customer: row.user
          ? {name: row.user.name, email: row.user.email}
          : null,
        orderId: order ? order.orderId : '',
        orderStatus: order ? order.orderStatus : '',
        orderTotal: order ? order.total + (order.walletUsed || 0) : 0,
      };
    }),
    totals: {
      discountGiven: summary.discount,
      uses: summary.uses,
      customers: summary.customers.length,
    },
    pagination: {
      page,
      pages: Math.max(1, Math.ceil(summary.uses / PAGE_SIZE)),
      total: summary.uses,
      limit: PAGE_SIZE,
    },
  };
}

async function createCoupon(value) {
  try {
    const coupon = await Coupon.create(value);
    return toAdminCoupon(coupon);
  } catch (error) {
    // A deleted coupon still holds its code, because the code is unique across the collection.
    if (error.code === 11000) {
      throw new HttpError(
        409,
        `The code ${value.code} is already used by another coupon.`,
        {code: 'That code is already taken.'},
      );
    }
    throw error;
  }
}

// Editing never touches usedCount: the number of times a coupon has been used is a fact.
async function updateCoupon(couponId, value) {
  const coupon = await findCoupon(couponId);
  Object.assign(coupon, value);
  try {
    await coupon.save();
  } catch (error) {
    if (error.code === 11000) {
      throw new HttpError(
        409,
        `The code ${value.code} is already used by another coupon.`,
        {code: 'That code is already taken.'},
      );
    }
    throw error;
  }
  return toAdminCoupon(coupon);
}

// The enable/disable toggle. A disabled coupon is refused at checkout at once (couponProblem
// checks isActive), but keeps its history.
async function setActive(couponId, isActive) {
  const coupon = await findCoupon(couponId);
  coupon.isActive = isActive;
  await coupon.save();
  return toAdminCoupon(coupon);
}

// Soft delete: gone from the list and never usable again, but its redemptions stay, so past
// orders still show which coupon they used.
async function deleteCoupon(couponId) {
  const coupon = await findCoupon(couponId);
  coupon.isDeleted = true;
  coupon.deletedAt = new Date();
  coupon.isActive = false;
  await coupon.save();
  return toAdminCoupon(coupon);
}

module.exports = {
  PAGE_SIZE,
  STATUSES,
  STATUS_LABELS,
  SORTS,
  statusOf,
  toAdminCoupon,
  readFilters,
  statusFilter,
  listCoupons,
  getCoupon,
  getCouponDetail,
  createCoupon,
  updateCoupon,
  setActive,
  deleteCoupon,
};
