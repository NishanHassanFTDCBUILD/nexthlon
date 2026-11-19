// Admin pages for the Sales group: orders, one order, returns, transactions (and one entry, and the
// daily reconciliation), and refunds. The data comes from the services.
const config = require('../config/env');
const adminOrderService = require('../services/adminOrderService');
const ledgerService = require('../services/ledgerService');
const Order = require('../models/Order');
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
    tagOptions: rules.ORDER_TAGS,
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
// New deal: starts now and runs a day, unless "Run again" (?from=<dealId>) copies an old deal,
// or a product link (?product=<id>) picks the product.
const dealNew = asyncHandler(async (req, res) => {
  const now = new Date();
  now.setSeconds(0, 0);
  let defaults = {
    productIds:
      typeof req.query.product === 'string' ? [req.query.product] : [],
    percent: '',
    note: '',
    sortOrder: 0,
    startsInput: dealService.toLocalInput(now),
    endsInput: dealService.toLocalInput(
      new Date(now.getTime() + 24 * 60 * 60 * 1000),
    ),
  };
  if (typeof req.query.from === 'string')
    defaults = await dealService.copyForRerun(req.query.from, now);
  res.render('admin/deal-form', {
    title: 'New deal | Nexthlon Admin',
    deal: null,
    defaults,
    rerun: typeof req.query.from === 'string',
    picked: await dealService.pickedProducts(defaults.productIds),
  });
});

const dealEdit = asyncHandler(async (req, res) => {
  const deal = await dealService.getDeal(req.params.dealId);
  res.render('admin/deal-form', {
    title: 'Edit deal | Nexthlon Admin',
    deal,
    defaults: {},
    rerun: false,
    picked: await dealService.pickedProducts([deal.productId]),
  });
});

// GET <ADMIN_PATH>/orders/print?ids=NX-...  The chosen orders, one page each, for printing.
const printOrders = asyncHandler(async (req, res) => {
  const ids = String(req.query.ids || '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => /^NX-\d{4}-\d{6}$/.test(id))
    .slice(0, 50);
  const orders = ids.length
    ? await Order.find({orderId: {$in: ids}})
        .sort({createdAt: 1})
        .limit(50)
        .lean()
    : [];
  res.render('admin/print-orders', {
    title: 'Print orders | Nexthlon Admin',
    orders,
    asked: ids.length,
    rules,
  });
});

// ---------- Pick list: what to take off the shelves for a set of orders ----------
// GET <ADMIN_PATH>/orders/pick-list?ids=NX-2026-000001,NX-2026-000002  (or no ids: every order to ship)
const pickList = asyncHandler(async (req, res) => {
  const ids = String(req.query.ids || '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => /^NX-\d{4}-\d{6}$/.test(id))
    .slice(0, 200);
  const filter = ids.length
    ? {orderId: {$in: ids}}
    : {orderStatus: 'confirmed'};
  const orders = await Order.find(filter)
    .sort({createdAt: 1})
    .limit(200)
    .select(
      'orderId orderStatus createdAt items.name items.option items.sku items.quantity items.status items.product',
    )
    .lean();
  const lines = new Map();
  for (const order of orders)
    for (const item of order.items) {
      if (item.status === 'cancelled' || item.status === 'returned') continue;
      const key = [String(item.product), item.option || ''].join('|');
      const line = lines.get(key) || {
        name: item.name,
        option: item.option || '',
        sku: item.sku || '',
        units: 0,
        orders: [],
      };
      line.units += item.quantity;
      line.orders.push(order.orderId);
      lines.set(key, line);
    }
  const sorted = [...lines.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.option.localeCompare(b.option),
  );
  res.render('admin/pick-list', {
    title: 'Pick list | Nexthlon Admin',
    lines: sorted,
    orderCount: orders.length,
    units: sorted.reduce((sum, line) => sum + line.units, 0),
    scope: ids.length ? 'the orders you chose' : 'every order to ship',
    late: orders.filter(
      (o) =>
        ['placed', 'confirmed'].includes(o.orderStatus) &&
        Date.now() >
          new Date(o.createdAt).getTime() +
            require('../utils/orderRules').SHIP_WITHIN_HOURS * 3600000,
    ).length,
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
  coupons,
  couponNew,
  couponEdit,
  coupon,
  deals,
  dealNew,
  dealEdit,
  pickList,
  printOrders,
};
