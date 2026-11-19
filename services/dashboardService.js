// The admin dashboard: KPIs for a date range (with the change against the previous period), the
// series behind every chart, and the "needs attention" panels. Everything is computed with
// MongoDB aggregations in India time (Asia/Kolkata), so a "day" is an Indian calendar day.
// Money is in paise.
const Order = require('../models/Order');
const User = require('../models/User');
const Product = require('../models/Product');
const WalletTransaction = require('../models/WalletTransaction');
const LoginActivity = require('../models/LoginActivity');
const {LOW_STOCK_LIMIT} = require('../config/catalog');
const {PAID_STATUSES} = require('../utils/orderRules');
const {LISTED_PRODUCT} = require('../utils/queryFilters');

const TZ = 'Asia/Kolkata';
const IST_MS = 330 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const RANGES = ['today', '7d', '30d', 'month', 'year', 'custom'];
const RANGE_LABELS = {
  today: 'Today',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  month: 'This month',
  year: 'This year',
  custom: 'Custom',
};

// ---------- Dates in India time ----------
const istParts = (date) => {
  const shifted = new Date(date.getTime() + IST_MS);
  return {
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth(),
    d: shifted.getUTCDate(),
    h: shifted.getUTCHours(),
  };
};
// The moment a given Indian date/hour begins.
const istDate = (y, m, d = 1, h = 0) => new Date(Date.UTC(y, m, d, h) - IST_MS);
const istDayStart = (date) => {
  const p = istParts(date);
  return istDate(p.y, p.m, p.d);
};
const isoDay = (date) => {
  const p = istParts(date);
  return `${p.y}-${String(p.m + 1).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
};
function parseDay(text) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(
    typeof text === 'string' ? text : '',
  );
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]) - 1, Number(match[3])];
  const date = istDate(y, m, d);
  const back = istParts(date);
  return back.y === y && back.m === m && back.d === d ? date : null; // rejects 2026-02-31
}

// Reads ?range=today|7d|30d|month|year|custom (&from=YYYY-MM-DD&to=YYYY-MM-DD) into exact times.
// Bad input falls back to the last 7 days; a custom range must be real dates, in order, no later
// than today and at most a year long. The previous period has the same length, just before it.
function readRange(query = {}, now = new Date()) {
  let key = RANGES.includes(query.range) ? query.range : '7d';
  const today = istDayStart(now);
  const p = istParts(now);
  let from;
  let to = now;
  let prevFrom;
  let prevTo;
  let error = '';

  if (key === 'custom') {
    const start = parseDay(query.from);
    const end = parseDay(query.to);
    if (!start || !end) error = 'Pick a start and an end date.';
    else if (start > end)
      error = 'The start date must be on or before the end date.';
    else if (end > today) error = "The end date can't be in the future.";
    else if ((end - start) / DAY > 365)
      error = 'A custom range can be at most a year long.';
    if (error) {
      key = '7d';
    } else {
      from = start;
      to = new Date(Math.min(end.getTime() + DAY, now.getTime()));
      const length = Math.round((end - start) / DAY) + 1;
      prevTo = from;
      prevFrom = new Date(from.getTime() - length * DAY);
    }
  }
  if (key === 'today') {
    from = today;
    prevFrom = new Date(from.getTime() - DAY);
    prevTo = new Date(to.getTime() - DAY);
  } else if (key === '7d' || key === '30d') {
    const days = key === '7d' ? 7 : 30;
    from = new Date(today.getTime() - (days - 1) * DAY);
    prevFrom = new Date(from.getTime() - days * DAY);
    prevTo = new Date(to.getTime() - days * DAY);
  } else if (key === 'month') {
    from = istDate(p.y, p.m, 1);
    prevFrom = istDate(p.m === 0 ? p.y - 1 : p.y, (p.m + 11) % 12, 1);
    prevTo = new Date(
      Math.min(prevFrom.getTime() + (to - from), from.getTime()),
    );
  } else if (key === 'year') {
    from = istDate(p.y, 0, 1);
    prevFrom = istDate(p.y - 1, 0, 1);
    prevTo = new Date(
      Math.min(prevFrom.getTime() + (to - from), from.getTime()),
    );
  }

  const spanDays = (to - from) / DAY;
  const bucket =
    key === 'today' || spanDays <= 2
      ? 'hour'
      : spanDays <= 92
        ? 'day'
        : 'month';
  return {
    key,
    label: RANGE_LABELS[key],
    from,
    to,
    prevFrom,
    prevTo,
    bucket,
    fromDay: isoDay(from),
    toDay: isoDay(new Date(to.getTime() - 1)),
    error,
  };
}

// Every bucket start between from and to (so empty hours/days/months show as zero).
function bucketStarts(range) {
  const starts = [];
  const {from, to, bucket} = range;
  if (bucket === 'hour') {
    for (let t = from.getTime(); t < to.getTime(); t += HOUR)
      starts.push(new Date(t));
  } else if (bucket === 'day') {
    for (let t = istDayStart(from).getTime(); t < to.getTime(); t += DAY)
      starts.push(new Date(t));
  } else {
    let {y, m} = istParts(from);
    for (let start = istDate(y, m, 1); start < to; start = istDate(y, m, 1)) {
      starts.push(start);
      m += 1;
      if (m === 12) {
        m = 0;
        y += 1;
      }
    }
  }
  return starts;
}

function bucketLabel(date, bucket) {
  const p = istParts(date);
  if (bucket === 'hour') return `${String(p.h).padStart(2, '0')}:00`;
  if (bucket === 'day') return `${p.d} ${MONTHS[p.m]}`;
  return `${MONTHS[p.m]} ${p.y}`;
}

// ---------- Aggregation helpers ----------
const inRange = (field, from, to) => ({[field]: {$gte: from, $lt: to}});
const truncate = (field, bucket) => ({
  $dateTrunc: {date: `$${field}`, unit: bucket, timezone: TZ},
});
// Money actually received for a paid order: what was charged plus the wallet part, less refunds.
const WALLET = {$ifNull: ['$walletUsed', 0]};
const CHARGED = {$add: [{$ifNull: ['$total', 0]}, WALLET]};
const PAID_AMOUNT = {$subtract: [CHARGED, {$ifNull: ['$refundedAmount', 0]}]};
const isPaid = {$in: ['$paymentStatus', PAID_STATUSES]};

// The eight KPI totals for one period, and (when by is a bucket) the same per bucket.
async function kpiFigures(from, to, bucket = null) {
  const group = bucket
    ? {$dateTrunc: {date: '$createdAt', unit: bucket, timezone: TZ}}
    : null;
  const byOrder = await Order.aggregate([
    {$match: inRange('createdAt', from, to)},
    {
      $group: {
        _id: group,
        orders: {$sum: 1},
        revenue: {$sum: {$cond: [isPaid, PAID_AMOUNT, 0]}},
        paidOrders: {$sum: {$cond: [isPaid, 1, 0]}},
        coupons: {
          $sum: {
            $cond: [
              {$ne: ['$orderStatus', 'cancelled']},
              {$ifNull: ['$couponDiscount', 0]},
              0,
            ],
          },
        },
        buyers: {$addToSet: '$user'},
      },
    },
  ]);
  const [customers, refunds, credits, signedIn] = await Promise.all([
    User.aggregate([
      {$match: {role: 'customer', ...inRange('createdAt', from, to)}},
      {
        $group: {
          _id: bucket ? truncate('createdAt', bucket) : null,
          count: {$sum: 1},
        },
      },
    ]),
    Order.aggregate([
      {$match: {'refunds.at': {$gte: from, $lt: to}}},
      {$unwind: '$refunds'},
      {
        $match: {
          'refunds.status': 'processed',
          ...inRange('refunds.at', from, to),
        },
      },
      {
        $group: {
          _id: bucket ? truncate('refunds.at', bucket) : null,
          amount: {$sum: '$refunds.amount'},
        },
      },
    ]),
    WalletTransaction.aggregate([
      {
        $match: {
          type: 'credit',
          kind: {$in: ['referral', 'admin']},
          applied: {$ne: false},
          ...inRange('createdAt', from, to),
        },
      },
      {
        $group: {
          _id: bucket ? truncate('createdAt', bucket) : null,
          amount: {$sum: '$amount'},
        },
      },
    ]),
    LoginActivity.aggregate([
      {$match: inRange('at', from, to)},
      {
        $group: {
          _id: bucket ? truncate('at', bucket) : null,
          users: {$addToSet: '$user'},
        },
      },
    ]),
  ]);
  return {byOrder, customers, refunds, credits, signedIn};
}

// Conversion: of the customers active in the period (signed in, or ordered), how many ordered.
// (A visitor-based funnel arrives with event tracking in the Analytics part.)
function conversion(buyers = [], signedIn = [], customerIds) {
  const active = new Set([
    ...signedIn.map(String).filter((id) => customerIds.has(id)),
    ...buyers.map(String),
  ]);
  return active.size ? (buyers.length / active.size) * 100 : 0;
}

function totalsFrom(figures, customerIds) {
  const order = figures.byOrder[0] || {
    orders: 0,
    revenue: 0,
    paidOrders: 0,
    coupons: 0,
    buyers: [],
  };
  return {
    revenue: order.revenue,
    orders: order.orders,
    aov: order.paidOrders ? Math.round(order.revenue / order.paidOrders) : 0,
    customers: (figures.customers[0] || {count: 0}).count,
    conversion: conversion(
      order.buyers,
      (figures.signedIn[0] || {users: []}).users,
      customerIds,
    ),
    refunds: (figures.refunds[0] || {amount: 0}).amount,
    credits: (figures.credits[0] || {amount: 0}).amount,
    coupons: order.coupons,
  };
}

// The % change, or null when there is nothing to compare with.
function change(now, before) {
  if (!before) return now ? null : 0;
  return Math.round(((now - before) / before) * 1000) / 10;
}

async function customerIdSet(figureSets) {
  const ids = new Set();
  figureSets.forEach((figures) =>
    figures.signedIn.forEach((row) =>
      row.users.forEach((id) => ids.add(String(id))),
    ),
  );
  if (!ids.size) return new Set();
  const customers = await User.find({_id: {$in: [...ids]}, role: 'customer'})
    .select('_id')
    .lean();
  return new Set(customers.map((user) => String(user._id)));
}

const KPI_META = [
  {key: 'revenue', label: 'Revenue (paid)', format: 'money', goodWhenUp: true},
  {key: 'orders', label: 'Orders', format: 'number', goodWhenUp: true},
  {key: 'aov', label: 'Average order value', format: 'money', goodWhenUp: true},
  {
    key: 'customers',
    label: 'New customers',
    format: 'number',
    goodWhenUp: true,
  },
  {
    key: 'conversion',
    label: 'Conversion rate',
    format: 'percent',
    goodWhenUp: true,
    hint: 'Customers who ordered, out of those who signed in or ordered',
  },
  {key: 'refunds', label: 'Refunds', format: 'money', goodWhenUp: false},
  {
    key: 'credits',
    label: 'Wallet credits given',
    format: 'money',
    goodWhenUp: false,
    hint: 'Referral rewards and credits added by admins',
  },
  {
    key: 'coupons',
    label: 'Coupon discounts',
    format: 'money',
    goodWhenUp: false,
  },
];

async function kpis(range) {
  const [current, previous, perBucket] = await Promise.all([
    kpiFigures(range.from, range.to),
    kpiFigures(range.prevFrom, range.prevTo),
    kpiFigures(range.from, range.to, range.bucket),
  ]);
  const customerIds = await customerIdSet([current, previous, perBucket]);
  const now = totalsFrom(current, customerIds);
  const before = totalsFrom(previous, customerIds);

  // Sparklines: one value per bucket for each KPI.
  const starts = bucketStarts(range);
  const pick = (rows, at) =>
    rows.find((row) => row._id && row._id.getTime() === at.getTime());
  const spark = Object.fromEntries(KPI_META.map((meta) => [meta.key, []]));
  for (const at of starts) {
    const totals = totalsFrom(
      {
        byOrder: [pick(perBucket.byOrder, at)].filter(Boolean),
        customers: [pick(perBucket.customers, at)].filter(Boolean),
        refunds: [pick(perBucket.refunds, at)].filter(Boolean),
        credits: [pick(perBucket.credits, at)].filter(Boolean),
        signedIn: [pick(perBucket.signedIn, at)].filter(Boolean),
      },
      customerIds,
    );
    KPI_META.forEach((meta) =>
      spark[meta.key].push(Math.round(totals[meta.key] * 10) / 10),
    );
  }

  return KPI_META.map((meta) => ({
    ...meta,
    value:
      meta.format === 'percent'
        ? Math.round(now[meta.key] * 10) / 10
        : now[meta.key],
    previous:
      meta.format === 'percent'
        ? Math.round(before[meta.key] * 10) / 10
        : before[meta.key],
    change: change(now[meta.key], before[meta.key]),
    spark: spark[meta.key],
  }));
}

// ---------- Charts ----------
async function charts(range) {
  const match = {$match: inRange('createdAt', range.from, range.to)};
  const liveItems = [
    match,
    {$match: {orderStatus: {$ne: 'cancelled'}}},
    {$unwind: '$items'},
    {$match: {'items.status': {$ne: 'cancelled'}}},
  ];
  const [
    timeline,
    statuses,
    payments,
    categories,
    products,
    cities,
    states,
    newReturning,
    heat,
  ] = await Promise.all([
    Order.aggregate([
      match,
      {
        $group: {
          _id: truncate('createdAt', range.bucket),
          orders: {$sum: 1},
          revenue: {$sum: {$cond: [isPaid, PAID_AMOUNT, 0]}},
        },
      },
    ]),
    Order.aggregate([
      match,
      {$group: {_id: '$orderStatus', count: {$sum: 1}}},
      {$sort: {count: -1}},
    ]),
    Order.aggregate([
      match,
      {
        $group: {
          _id: '$paymentMethod',
          count: {$sum: 1},
          amount: {$sum: CHARGED},
        },
      },
      {$sort: {count: -1}},
    ]),
    Order.aggregate([
      ...liveItems,
      {
        $lookup: {
          from: 'products',
          localField: 'items.product',
          foreignField: '_id',
          as: 'product',
          pipeline: [{$project: {category: 1}}],
        },
      },
      {
        $lookup: {
          from: 'categories',
          localField: 'product.category',
          foreignField: '_id',
          as: 'category',
          pipeline: [{$project: {name: 1}}],
        },
      },
      {
        $group: {
          _id: {$ifNull: [{$first: '$category.name'}, 'Other']},
          revenue: {$sum: '$items.lineTotal'},
          units: {$sum: '$items.quantity'},
        },
      },
      {$sort: {revenue: -1}},
      {$limit: 10},
    ]),
    Order.aggregate([
      ...liveItems,
      {
        $group: {
          _id: '$items.product',
          name: {$last: '$items.name'},
          revenue: {$sum: '$items.lineTotal'},
          units: {$sum: '$items.quantity'},
        },
      },
      {$sort: {revenue: -1}},
      {$limit: 50},
    ]),
    Order.aggregate([
      match,
      {$match: {orderStatus: {$ne: 'cancelled'}}},
      {
        $group: {
          _id: {city: '$address.city', state: '$address.state'},
          orders: {$sum: 1},
          revenue: {$sum: CHARGED},
        },
      },
      {$sort: {revenue: -1}},
      {$limit: 10},
    ]),
    Order.aggregate([
      match,
      {$match: {orderStatus: {$ne: 'cancelled'}}},
      {
        $group: {
          _id: '$address.state',
          orders: {$sum: 1},
          revenue: {$sum: CHARGED},
        },
      },
      {$sort: {revenue: -1}},
      {$limit: 10},
    ]),
    // An order is from a returning customer when the same customer ordered before it.
    Order.aggregate([
      match,
      {
        $lookup: {
          from: 'orders',
          let: {user: '$user', at: '$createdAt'},
          as: 'earlier',
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    {$eq: ['$user', '$$user']},
                    {$lt: ['$createdAt', '$$at']},
                  ],
                },
              },
            },
            {$limit: 1},
            {$project: {_id: 1}},
          ],
        },
      },
      {
        $group: {
          _id: truncate('createdAt', range.bucket),
          newCustomers: {
            $sum: {$cond: [{$eq: [{$size: '$earlier'}, 0]}, 1, 0]},
          },
          returning: {$sum: {$cond: [{$gt: [{$size: '$earlier'}, 0]}, 1, 0]}},
        },
      },
    ]),
    Order.aggregate([
      match,
      {
        $group: {
          _id: {
            day: {$dayOfWeek: {date: '$createdAt', timezone: TZ}},
            hour: {$hour: {date: '$createdAt', timezone: TZ}},
          },
          count: {$sum: 1},
        },
      },
    ]),
  ]);

  const starts = bucketStarts(range);
  const at = (rows, start) =>
    rows.find((row) => row._id && row._id.getTime() === start.getTime()) || {};
  const byUnits = [...products].sort(
    (a, b) => b.units - a.units || b.revenue - a.revenue,
  );
  // Heatmap rows: Monday first. MongoDB counts Sunday as day 1.
  const heatmap = Array.from({length: 7}, () => Array(24).fill(0));
  heat.forEach((row) => {
    heatmap[(row._id.day + 5) % 7][row._id.hour] = row.count;
  });

  return {
    bucket: range.bucket,
    timeline: starts.map((start) => ({
      label: bucketLabel(start, range.bucket),
      orders: at(timeline, start).orders || 0,
      revenue: at(timeline, start).revenue || 0,
    })),
    statuses: statuses.map((row) => ({key: row._id, count: row.count})),
    payments: payments.map((row) => ({
      key: row._id,
      count: row.count,
      amount: row.amount,
    })),
    categories: categories.map((row) => ({
      name: row._id,
      revenue: row.revenue,
      units: row.units,
    })),
    topByRevenue: products.slice(0, 10).map((row) => ({
      id: String(row._id),
      name: row.name,
      revenue: row.revenue,
      units: row.units,
    })),
    topByUnits: byUnits.slice(0, 10).map((row) => ({
      id: String(row._id),
      name: row.name,
      revenue: row.revenue,
      units: row.units,
    })),
    cities: cities.map((row) => ({
      city: row._id.city || 'Unknown',
      state: row._id.state || '',
      orders: row.orders,
      revenue: row.revenue,
    })),
    states: states.map((row) => ({
      state: row._id || 'Unknown',
      orders: row.orders,
      revenue: row.revenue,
    })),
    newReturning: starts.map((start) => ({
      label: bucketLabel(start, range.bucket),
      newCustomers: at(newReturning, start).newCustomers || 0,
      returning: at(newReturning, start).returning || 0,
    })),
    heatmap,
  };
}

// ---------- Panels (not tied to the date range) ----------
async function panels() {
  const [
    recentOrders,
    toConfirm,
    toShip,
    returns,
    failedPayments,
    lowStockCount,
    outOfStock,
    stockList,
    recentCustomers,
    products,
    customers,
    blockedCustomers,
    newCustomers,
  ] = await Promise.all([
    Order.find()
      .sort({createdAt: -1})
      .limit(10)
      .select(
        'orderId total walletUsed orderStatus paymentStatus paymentMethod createdAt address.fullName address.city',
      )
      .lean(),
    Order.countDocuments({orderStatus: 'placed'}),
    Order.countDocuments({orderStatus: 'confirmed'}),
    Order.countDocuments({orderStatus: 'return_requested'}),
    Order.countDocuments({
      paymentStatus: 'failed',
      orderStatus: {$ne: 'cancelled'},
    }),
    Product.countDocuments({
      ...LISTED_PRODUCT,
      stock: {$gt: 0, $lte: LOW_STOCK_LIMIT},
    }),
    Product.countDocuments({...LISTED_PRODUCT, stock: 0}),
    Product.find({...LISTED_PRODUCT, stock: {$lte: LOW_STOCK_LIMIT}})
      .sort({stock: 1, name: 1})
      .limit(8)
      .select('name stock image')
      .lean(),
    User.find({role: 'customer', isDeleted: {$ne: true}})
      .sort({createdAt: -1})
      .limit(6)
      .select('name email createdAt isBlocked')
      .lean(),
    Product.countDocuments({...LISTED_PRODUCT}),
    User.countDocuments({role: 'customer'}),
    User.countDocuments({role: 'customer', isBlocked: true}),
    User.countDocuments({
      role: 'customer',
      createdAt: {$gte: new Date(Date.now() - 7 * DAY)},
    }),
  ]);
  return {
    recentOrders: recentOrders.map((o) => ({
      orderId: o.orderId,
      customer: (o.address && o.address.fullName) || '',
      city: (o.address && o.address.city) || '',
      amount: o.total + (o.walletUsed || 0),
      status: o.orderStatus,
      paymentStatus: o.paymentStatus,
      paymentMethod: o.paymentMethod,
      createdAt: o.createdAt,
    })),
    actions: [
      {
        key: 'confirm',
        label: 'Orders to confirm',
        count: toConfirm,
        href: 'orders?status=placed',
        icon: 'clock',
      },
      {
        key: 'ship',
        label: 'Orders to ship',
        count: toShip,
        href: 'orders?status=confirmed',
        icon: 'truck',
      },
      {
        key: 'returns',
        label: 'Return requests',
        count: returns,
        href: 'returns',
        icon: 'rotate-ccw',
      },
      {
        key: 'failed',
        label: 'Failed payments',
        count: failedPayments,
        href: 'transactions?status=failed',
        icon: 'credit-card',
      },
      {
        key: 'stock',
        label: 'Low-stock products',
        count: lowStockCount + outOfStock,
        href: 'products?status=low',
        icon: 'alert',
      },
    ],
    stockList: stockList.map((p) => ({
      id: String(p._id),
      name: p.name,
      stock: p.stock,
      image: p.image,
    })),
    recentCustomers: recentCustomers.map((c) => ({
      id: String(c._id),
      name: c.name,
      email: c.email,
      createdAt: c.createdAt,
      isBlocked: Boolean(c.isBlocked),
    })),
    stock: {
      products,
      lowStock: lowStockCount,
      outOfStock,
      healthy: Math.max(products - lowStockCount - outOfStock, 0),
    },
    people: {customers, blockedCustomers, newCustomers},
  };
}

async function dashboard(query = {}, now = new Date()) {
  const range = readRange(query, now);
  const [kpiList, chartData, panelData] = await Promise.all([
    kpis(range),
    charts(range),
    panels(),
  ]);
  return {range, kpis: kpiList, charts: chartData, panels: panelData};
}

module.exports = {
  RANGES,
  RANGE_LABELS,
  KPI_META,
  readRange,
  bucketStarts,
  bucketLabel,
  change,
  dashboard,
  kpis,
  charts,
  panels,
};
