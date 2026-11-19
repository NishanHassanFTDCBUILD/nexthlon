// Admin pages for the Sales group: orders, one order, returns, transactions (and one entry, and the
// daily reconciliation), refunds and abandoned carts. The data comes from the services.
const config = require('../config/env');
const adminOrderService = require('../services/adminOrderService');
const ledgerService = require('../services/ledgerService');
const cartRecoveryService = require('../services/cartRecoveryService');
const adminCouponService = require('../services/adminCouponService');
const dealService = require('../services/dealService');
const rules = require('../utils/orderRules');
const {linkBuilder} = require('../utils/queryString');
const {asyncHandler} = require('../utils/http');

const base = (section) => `${config.adminPath}/${section}`;
const labels = {
  statusLabels: rules.STATUS_LABELS,
  methodLabels: {
    razorpay: 'Razorpay',
    cod: 'Cash on delivery',
    wallet: 'Wallet',
  },
};
// The current filters without their defaults, so links stay short.
const without = (filters, defaults) =>
  Object.fromEntries(
    Object.entries(filters).filter(
      ([key, value]) =>
        key !== 'page' &&
        value !== defaults[key] &&
        value !== '' &&
        value !== 'all',
    ),
  );

const orders = asyncHandler(async (req, res) => {
  const data = await adminOrderService.listOrders(req.query);
  const current = without(data.filters, {sort: 'newest'});
  res.render('admin/orders', {
    title: 'Orders | Nexthlon Admin',
    ...data,
    ...labels,
    current,
    link: linkBuilder(base('orders'), current),
    exportQuery: new URLSearchParams(current).toString(),
    sorts: adminOrderService.ORDER_SORTS,
    statuses: rules.ORDER_STATUSES,
    paymentStatuses: rules.PAYMENT_STATUSES,
    methods: adminOrderService.METHODS,
  });
});

const order = asyncHandler(async (req, res) => {
  const data = await adminOrderService.getOrder(req.params.orderId);
  res.render('admin/order', {
    title: `${data.order.orderId} | Nexthlon Admin`,
    ...data,
    ...labels,
    cancelReasons: rules.CANCEL_REASONS,
    // B5: "shiprocket" shows the one-click button; "manual" only the courier and AWB form.
    shippingProvider: config.shipping.provider,
  });
});

const returns = asyncHandler(async (req, res) => {
  const data = await adminOrderService.listReturns(req.query);
  const current = without(data.filters, {status: 'requested'});
  res.render('admin/returns', {
    title: 'Returns | Nexthlon Admin',
    ...data,
    ...labels,
    link: linkBuilder(base('returns'), {
      ...current,
      status: data.filters.status,
    }),
  });
});

const transactions = asyncHandler(async (req, res) => {
  const data = await ledgerService.listTransactions(req.query);
  const current = without(data.filters, {});
  res.render('admin/transactions', {
    title: 'Transactions | Nexthlon Admin',
    ...data,
    ...labels,
    link: linkBuilder(base('transactions'), current),
    exportQuery: new URLSearchParams(current).toString(),
    types: ledgerService.TYPES,
    typeLabels: ledgerService.TYPE_LABELS,
    txStatuses: ledgerService.STATUSES,
    txMethods: ledgerService.METHODS,
  });
});

const transaction = asyncHandler(async (req, res) => {
  const data = await ledgerService.getTransaction(req.params.id);
  res.render('admin/transaction', {
    title: 'Transaction | Nexthlon Admin',
    ...data,
    ...labels,
    typeLabels: ledgerService.TYPE_LABELS,
  });
});

const reconciliation = asyncHandler(async (req, res) => {
  const data = await ledgerService.reconciliation(req.query);
  res.render('admin/reconciliation', {
    title: 'Reconciliation | Nexthlon Admin',
    ...data,
    ...labels,
  });
});

const refunds = asyncHandler(async (req, res) => {
  const data = await ledgerService.listRefunds(req.query);
  const current = without(data.filters, {});
  delete current.type;
  res.render('admin/refunds', {
    title: 'Refunds | Nexthlon Admin',
    ...data,
    ...labels,
    link: linkBuilder(base('refunds'), current),
  });
});

const abandonedCarts = asyncHandler(async (req, res) => {
  const data = await cartRecoveryService.listAbandoned(req.query);
  res.render('admin/abandoned-carts', {
    title: 'Abandoned carts | Nexthlon Admin',
    ...data,
    sorts: {
      value: 'Highest value',
      oldest: 'Waiting longest',
      newest: 'Most recent',
    },
    link: linkBuilder(
      base('abandoned-carts'),
      without(data.filters, {sort: 'value'}),
    ),
  });
});

// ---------- Coupons ----------

const coupons = asyncHandler(async (req, res) => {
  const data = await adminCouponService.listCoupons(req.query);
  const current = without(data.filters, {sort: 'newest'});
  res.render('admin/coupons', {
    title: 'Coupons | Nexthlon Admin',
    ...data,
    link: linkBuilder(base('coupons'), current),
  });
});

// The create form and the edit form are the same page; product is null when creating.
const couponNew = (req, res) => {
  res.render('admin/coupon-form', {
    title: 'New coupon | Nexthlon Admin',
    coupon: null,
  });
};

const couponEdit = asyncHandler(async (req, res) => {
  const coupon = await adminCouponService.getCoupon(req.params.couponId);
  res.render('admin/coupon-form', {
    title: `Edit ${coupon.code} | Nexthlon Admin`,
    coupon,
  });
});

const coupon = asyncHandler(async (req, res) => {
  const data = await adminCouponService.getCouponDetail(
    req.params.couponId,
    req.query,
  );
  res.render('admin/coupon', {
    title: `${data.coupon.code} | Nexthlon Admin`,
    ...data,
    link: linkBuilder(base(`coupons/${data.coupon.id}`), {}),
    ...labels,
    statusLabels: adminCouponService.STATUS_LABELS,
  });
});

// ---------- Deals of the day ----------
const deals = asyncHandler(async (req, res) => {
  const data = await dealService.listDeals(req.query);
  const current = without(data.filters, {sort: 'starts'});
  res.render('admin/deals', {
    title: 'Deals of the day | Nexthlon Admin',
    ...data,
    sorts: dealService.SORTS,
    dealLabels: dealService.STATUS_LABELS,
    current,
    link: linkBuilder(base('deals'), current),
  });
});

// A new deal starts now and runs for a day, unless the admin changes it.
const dealNew = asyncHandler(async (req, res) => {
  const now = new Date();
  now.setSeconds(0, 0);
  res.render('admin/deal-form', {
    title: 'New deal | Nexthlon Admin',
    deal: null,
    defaults: {
      startsInput: dealService.toLocalInput(now),
      endsInput: dealService.toLocalInput(
        new Date(now.getTime() + 24 * 60 * 60 * 1000),
      ),
    },
    products: await dealService.productChoices(),
    picked: typeof req.query.product === 'string' ? req.query.product : '',
  });
});

const dealEdit = asyncHandler(async (req, res) => {
  const deal = await dealService.getDeal(req.params.dealId);
  res.render('admin/deal-form', {
    title: 'Edit deal | Nexthlon Admin',
    deal,
    defaults: {},
    products: await dealService.productChoices(),
    picked: deal.productId,
  });
});

module.exports = {
  orders,
  order,
  returns,
  transactions,
  transaction,
  reconciliation,
  refunds,
  abandonedCarts,
  coupons,
  couponNew,
  couponEdit,
  coupon,
  deals,
  dealNew,
  dealEdit,
};
