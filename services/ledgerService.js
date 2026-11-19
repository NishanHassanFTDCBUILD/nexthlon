// The money ledger: every money movement in one list, built live from the orders and the wallet
// (so nothing has to be written twice and it can never drift out of step).
//
//   payment          an online (Razorpay) payment: captured, failed or pending      money in
//   cod              cash collected on delivery                                     money in
//   wallet_payment   wallet money spent at checkout (internal, not new money)       -
//   refund           money given back (to the wallet or to the card/UPI)            money out
//   coupon           a coupon discount (money not taken, shown for the record)      -
//   wallet_credit    referral rewards and credits added by admins                   money out
//   wallet_debit     wallet money taken back by an admin                            -
//
// Entry ids say where an entry comes from (pay_<order>, cod_<order>, wpay_<order>,
// ref_<order>_<n>, cpn_<order>, wtx_<wallet transaction>), so one entry can always be found again.
const mongoose = require('mongoose');
const Order = require('../models/Order');
const User = require('../models/User');
const WalletTransaction = require('../models/WalletTransaction');
const {PAID_STATUSES} = require('../utils/orderRules');
const {HttpError} = require('../utils/http');
const {escapeRegex, toPositiveInt} = require('./productService');
const {pageSize} = require('../utils/paging');

const PAGE_SIZE = 25;
const IST_MS = 330 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;
const TZ = 'Asia/Kolkata';
const TYPES = [
  'payment',
  'cod',
  'wallet_payment',
  'refund',
  'coupon',
  'wallet_credit',
  'wallet_debit',
];
const TYPE_LABELS = {
  payment: 'Online payment',
  cod: 'Cash on delivery',
  wallet_payment: 'Wallet payment',
  refund: 'Refund',
  coupon: 'Coupon discount',
  wallet_credit: 'Wallet credit',
  wallet_debit: 'Wallet debit',
};
const STATUSES = [
  'captured',
  'failed',
  'pending',
  'collected',
  'processed',
  'applied',
  'completed',
];
const METHODS = ['razorpay', 'cod', 'wallet', 'original'];

function istDay(text) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(
    typeof text === 'string' ? text : '',
  );
  if (!match) return null;
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) - IST_MS,
  );
  return Number.isNaN(date.getTime()) ? null : date;
}
const isoDay = (date) =>
  new Date(date.getTime() + IST_MS).toISOString().slice(0, 10);

// ---------- The union pipeline ----------
const str = (field) => ({$toString: field});
const common = (type, extra) => ({
  $project: {
    _id: 0,
    type: {$literal: type},
    orderId: '$orderId',
    user: '$user',
    ...extra,
  },
});

// sourceId (optional) limits every branch to one order / wallet transaction (for the detail page).
function branches(sourceId = null) {
  const only = sourceId ? [{$match: {_id: sourceId}}] : [];
  const paidList = PAID_STATUSES;
  return {
    payment: [
      ...only,
      {
        $match: {
          paymentMethod: 'razorpay',
          $or: [
            {'razorpay.paymentId': {$nin: ['', null]}},
            {paymentStatus: 'failed'},
          ],
        },
      },
      common('payment', {
        id: {$concat: ['pay_', str('$_id')]},
        at: '$createdAt',
        direction: {$cond: [{$in: ['$paymentStatus', paidList]}, 'in', 'none']},
        method: {$literal: 'razorpay'},
        amount: '$total',
        status: {
          $switch: {
            branches: [
              {case: {$in: ['$paymentStatus', paidList]}, then: 'captured'},
              {case: {$eq: ['$paymentStatus', 'failed']}, then: 'failed'},
            ],
            default: 'pending',
          },
        },
        reference: {$ifNull: ['$razorpay.paymentId', '']},
        note: {$ifNull: ['$razorpay.orderId', '']},
      }),
    ],
    cod: [
      ...only,
      {
        $match: {
          paymentMethod: 'cod',
          paymentStatus: {$in: paidList},
          total: {$gt: 0},
        },
      },
      common('cod', {
        id: {$concat: ['cod_', str('$_id')]},
        at: {$ifNull: ['$deliveredAt', '$updatedAt']},
        direction: {$literal: 'in'},
        method: {$literal: 'cod'},
        amount: '$total',
        status: {$literal: 'collected'},
        reference: {$literal: ''},
        note: {$literal: ''},
      }),
    ],
    walletPayment: [
      ...only,
      {$match: {walletUsed: {$gt: 0}}},
      common('wallet_payment', {
        id: {$concat: ['wpay_', str('$_id')]},
        at: '$createdAt',
        direction: {$literal: 'none'},
        method: {$literal: 'wallet'},
        amount: '$walletUsed',
        status: {$literal: 'captured'},
        reference: {$literal: ''},
        note: {$literal: ''},
      }),
    ],
    refund: [
      ...only,
      {$match: {'refunds.0': {$exists: true}}},
      {$unwind: {path: '$refunds', includeArrayIndex: 'n'}},
      common('refund', {
        id: {$concat: ['ref_', str('$_id'), '_', str('$n')]},
        at: '$refunds.at',
        direction: {$literal: 'out'},
        method: '$refunds.method',
        amount: '$refunds.amount',
        status: '$refunds.status',
        reference: {$ifNull: ['$refunds.razorpayRefundId', '']},
        note: {$ifNull: ['$refunds.reason', '']},
      }),
    ],
    coupon: [
      ...only,
      {$match: {couponDiscount: {$gt: 0}, orderStatus: {$ne: 'cancelled'}}},
      common('coupon', {
        id: {$concat: ['cpn_', str('$_id')]},
        at: '$createdAt',
        direction: {$literal: 'none'},
        method: {$literal: ''},
        amount: '$couponDiscount',
        status: {$literal: 'applied'},
        reference: '$couponCode',
        note: {$literal: ''},
      }),
    ],
    wallet: [
      ...only,
      // Refund credits and checkout debits are already listed above (as refunds and wallet payments).
      {$match: {kind: {$in: ['referral', 'admin']}, applied: {$ne: false}}},
      {
        $project: {
          _id: 0,
          id: {$concat: ['wtx_', str('$_id')]},
          at: '$createdAt',
          orderId: '$orderId',
          user: '$user',
          type: {
            $cond: [
              {$eq: ['$type', 'credit']},
              'wallet_credit',
              'wallet_debit',
            ],
          },
          direction: {$cond: [{$eq: ['$type', 'credit']}, 'out', 'none']},
          method: {$literal: 'wallet'},
          amount: '$amount',
          status: {$literal: 'completed'},
          reference: '$kind',
          note: '$reason',
        },
      },
    ],
  };
}

function unionPipeline(sourceId = null, onlyTypes = null) {
  const b = branches(sourceId);
  const orderBranches = [
    ['payment', b.payment],
    ['cod', b.cod],
    ['wallet_payment', b.walletPayment],
    ['refund', b.refund],
    ['coupon', b.coupon],
  ].filter(([type]) => !onlyTypes || onlyTypes.includes(type));
  const walletWanted =
    !onlyTypes ||
    onlyTypes.includes('wallet_credit') ||
    onlyTypes.includes('wallet_debit');
  const [first, ...rest] = orderBranches;
  const start = first
    ? first[1]
    : [{$match: {_id: null}}, {$project: {_id: 0}}];
  return [
    ...start,
    ...rest.map(([, pipeline]) => ({
      $unionWith: {coll: Order.collection.name, pipeline},
    })),
    ...(walletWanted
      ? [
          {
            $unionWith: {
              coll: WalletTransaction.collection.name,
              pipeline: b.wallet,
            },
          },
        ]
      : []),
  ];
}

// ---------- Filters ----------
function readFilters(query = {}) {
  return {
    type: TYPES.includes(query.type) ? query.type : 'all',
    status: STATUSES.includes(query.status) ? query.status : 'all',
    method: METHODS.includes(query.method) ? query.method : 'all',
    from: istDay(query.from) ? query.from : '',
    to: istDay(query.to) ? query.to : '',
    q: typeof query.q === 'string' ? query.q.trim().slice(0, 60) : '',
    page: toPositiveInt(query.page, 1),
  };
}

async function matchStage(filters) {
  const match = {};
  if (filters.type !== 'all') match.type = filters.type;
  if (filters.status !== 'all') match.status = filters.status;
  if (filters.method !== 'all') match.method = filters.method;
  if (filters.from || filters.to) {
    match.at = {};
    if (filters.from) match.at.$gte = istDay(filters.from);
    if (filters.to) match.at.$lt = new Date(istDay(filters.to).getTime() + DAY);
  }
  if (filters.q) {
    const pattern = new RegExp(escapeRegex(filters.q), 'i');
    const users = await User.find({$or: [{name: pattern}, {email: pattern}]})
      .select('_id')
      .limit(50)
      .lean();
    match.$or = [
      {orderId: pattern},
      {reference: pattern},
      ...(users.length ? [{user: {$in: users.map((u) => u._id)}}] : []),
    ];
  }
  return match;
}

const withCustomer = [
  {
    $lookup: {
      from: User.collection.name,
      localField: 'user',
      foreignField: '_id',
      as: 'customer',
      pipeline: [{$project: {name: 1, email: 1}}],
    },
  },
  {$set: {customer: {$first: '$customer'}}},
];

async function listTransactions(query = {}) {
  const size = pageSize(query, PAGE_SIZE);
  const filters = readFilters(query);
  filters.limit = size === PAGE_SIZE ? '' : size;
  const onlyTypes = filters.type === 'all' ? null : [filters.type];
  const [result] = await Order.aggregate([
    ...unionPipeline(null, onlyTypes),
    {$match: await matchStage(filters)},
    {
      $facet: {
        rows: [
          {$sort: {at: -1, id: -1}},
          {$skip: (filters.page - 1) * size},
          {$limit: size},
          ...withCustomer,
        ],
        totals: [
          {
            $group: {
              _id: '$direction',
              amount: {$sum: '$amount'},
              count: {$sum: 1},
            },
          },
        ],
        count: [{$count: 'n'}],
      },
    },
  ]);
  const sum = (direction) =>
    (result.totals.find((row) => row._id === direction) || {amount: 0}).amount;
  const total = result.count[0] ? result.count[0].n : 0;
  return {
    transactions: result.rows,
    totals: {
      in: sum('in'),
      out: sum('out'),
      net: sum('in') - sum('out'),
      other: sum('none'),
    },
    filters,
    pagination: {
      page: filters.page,
      pages: Math.max(1, Math.ceil(total / size)),
      total,
      limit: size,
    },
  };
}

// All matching entries, oldest first, for CSV/Excel (up to 50,000).
async function exportTransactions(query = {}) {
  const filters = readFilters(query);
  const onlyTypes = filters.type === 'all' ? null : [filters.type];
  const cursor = Order.aggregate([
    ...unionPipeline(null, onlyTypes),
    {$match: await matchStage(filters)},
    {$sort: {at: 1, id: 1}},
    {$limit: 50000},
    ...withCustomer,
  ]).cursor();
  return (async function* rows() {
    for await (const entry of cursor) {
      yield {
        ...entry,
        typeLabel: TYPE_LABELS[entry.type],
        customerName: entry.customer ? entry.customer.name : '',
        customerEmail: entry.customer ? entry.customer.email : '',
      };
    }
  })();
}

// One entry, found again from its id.
async function getTransaction(id) {
  const match =
    /^(pay|cod|wpay|cpn|ref|wtx)_([a-f0-9]{24})(?:_(\d{1,3}))?$/.exec(
      String(id || ''),
    );
  if (!match) throw new HttpError(404, 'Transaction not found.');
  const [, prefix, sourceId, index] = match;
  const typeOf = {
    pay: 'payment',
    cod: 'cod',
    wpay: 'wallet_payment',
    cpn: 'coupon',
    ref: 'refund',
    wtx: null,
  };
  const onlyTypes = typeOf[prefix]
    ? [typeOf[prefix]]
    : ['wallet_credit', 'wallet_debit'];
  const source = new mongoose.Types.ObjectId(sourceId);
  const pipeline =
    prefix === 'wtx'
      ? branches(source).wallet
      : unionPipeline(source, onlyTypes);
  const Model = prefix === 'wtx' ? WalletTransaction : Order;
  const rows = await Model.aggregate([
    ...pipeline,
    {
      $match: {
        id:
          index !== undefined
            ? `${prefix}_${sourceId}_${index}`
            : `${prefix}_${sourceId}`,
      },
    },
    ...withCustomer,
  ]);
  if (!rows.length) throw new HttpError(404, 'Transaction not found.');
  const entry = rows[0];
  const order = entry.orderId
    ? await Order.findOne({orderId: entry.orderId})
        .select(
          'orderId orderStatus paymentMethod paymentStatus total walletUsed refundedAmount createdAt',
        )
        .lean()
    : null;
  return {entry, order};
}

// ---------- Refunds ----------
async function listRefunds(query = {}) {
  const size = pageSize(query, PAGE_SIZE);
  const filters = readFilters({...query, type: 'refund'});
  filters.limit = size === PAGE_SIZE ? '' : size;
  const statuses = ['pending', 'processed', 'failed'];
  const status = statuses.includes(query.status) ? query.status : 'all';
  const match = await matchStage({...filters, status: 'all'});
  if (status !== 'all') match.status = status;
  const [result] = await Order.aggregate([
    ...unionPipeline(null, ['refund']),
    {$match: match},
    {
      $facet: {
        rows: [
          {$sort: {at: -1, id: -1}},
          {$skip: (filters.page - 1) * size},
          {$limit: size},
          ...withCustomer,
        ],
        byStatus: [
          {
            $group: {
              _id: '$status',
              amount: {$sum: '$amount'},
              count: {$sum: 1},
            },
          },
        ],
        count: [{$count: 'n'}],
      },
    },
  ]);
  const total = result.count[0] ? result.count[0].n : 0;
  return {
    refunds: result.rows,
    byStatus: Object.fromEntries(
      result.byStatus.map((row) => [
        row._id,
        {amount: row.amount, count: row.count},
      ]),
    ),
    filters: {...filters, status},
    pagination: {
      page: filters.page,
      pages: Math.max(1, Math.ceil(total / size)),
      total,
      limit: size,
    },
  };
}

// ---------- Daily reconciliation ----------
// For each day: online orders marked paid vs Razorpay payments recorded for them (by checkout
// or the webhook), and every order where the two don't agree.
async function reconciliation(query = {}, now = new Date()) {
  const days = [7, 30, 90].includes(Number(query.days))
    ? Number(query.days)
    : 30;
  const todayStart = istDay(isoDay(now));
  const from = new Date(todayStart.getTime() - (days - 1) * DAY);
  const [daily, paidNoPayment, paymentNotPaid, codUnpaid] = await Promise.all([
    Order.aggregate([
      {$match: {paymentMethod: 'razorpay', createdAt: {$gte: from}}},
      {
        $group: {
          _id: {$dateTrunc: {date: '$createdAt', unit: 'day', timezone: TZ}},
          markedPaid: {
            $sum: {$cond: [{$in: ['$paymentStatus', PAID_STATUSES]}, 1, 0]},
          },
          markedPaidAmount: {
            $sum: {
              $cond: [{$in: ['$paymentStatus', PAID_STATUSES]}, '$total', 0],
            },
          },
          recorded: {
            $sum: {
              $cond: [
                {$gt: [{$strLenCP: {$ifNull: ['$razorpay.paymentId', '']}}, 0]},
                1,
                0,
              ],
            },
          },
          recordedAmount: {
            $sum: {
              $cond: [
                {$gt: [{$strLenCP: {$ifNull: ['$razorpay.paymentId', '']}}, 0]},
                '$total',
                0,
              ],
            },
          },
        },
      },
    ]),
    Order.find({
      paymentMethod: 'razorpay',
      paymentStatus: {$in: PAID_STATUSES},
      'razorpay.paymentId': {$in: ['', null]},
      createdAt: {$gte: from},
    })
      .select('orderId total paymentStatus createdAt')
      .limit(100)
      .lean(),
    Order.find({
      paymentMethod: 'razorpay',
      paymentStatus: {$nin: PAID_STATUSES},
      'razorpay.paymentId': {$nin: ['', null]},
      createdAt: {$gte: from},
    })
      .select('orderId total paymentStatus createdAt razorpay.paymentId')
      .limit(100)
      .lean(),
    Order.find({
      paymentMethod: 'cod',
      orderStatus: 'delivered',
      paymentStatus: 'pending',
      createdAt: {$gte: from},
    })
      .select('orderId total paymentStatus createdAt')
      .limit(100)
      .lean(),
  ]);
  const rows = [];
  for (let i = 0; i < days; i++) {
    const start = new Date(todayStart.getTime() - i * DAY);
    const row = daily.find((d) => d._id.getTime() === start.getTime()) || {
      markedPaid: 0,
      markedPaidAmount: 0,
      recorded: 0,
      recordedAmount: 0,
    };
    rows.push({
      day: isoDay(start),
      date: start,
      ...row,
      _id: undefined,
      difference: row.markedPaidAmount - row.recordedAmount,
      matched:
        row.markedPaid === row.recorded &&
        row.markedPaidAmount === row.recordedAmount,
    });
  }
  const issues = [
    ...paidNoPayment.map((o) => ({
      kind: 'paid_without_payment',
      label: 'Marked paid, but no Razorpay payment recorded',
      orderId: o.orderId,
      amount: o.total,
      status: o.paymentStatus,
      at: o.createdAt,
    })),
    ...paymentNotPaid.map((o) => ({
      kind: 'payment_not_marked',
      label: 'Razorpay payment recorded, but the order is not marked paid',
      orderId: o.orderId,
      amount: o.total,
      status: o.paymentStatus,
      at: o.createdAt,
      reference: o.razorpay.paymentId,
    })),
    ...codUnpaid.map((o) => ({
      kind: 'cod_not_collected',
      label: 'Delivered (cash on delivery), but not marked paid',
      orderId: o.orderId,
      amount: o.total,
      status: o.paymentStatus,
      at: o.createdAt,
    })),
  ];
  return {
    days,
    rows,
    issues,
    mismatchedDays: rows.filter((row) => !row.matched).length,
  };
}

module.exports = {
  PAGE_SIZE,
  TYPES,
  TYPE_LABELS,
  STATUSES,
  METHODS,
  readFilters,
  listTransactions,
  exportTransactions,
  getTransaction,
  listRefunds,
  reconciliation,
};
