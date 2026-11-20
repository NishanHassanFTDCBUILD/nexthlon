const mongoose = require('mongoose');
const User = require('../models/User');
const Wallet = require('../models/Wallet');
const Product = require('../models/Product');
const Order = require('../models/Order');
const {RULES} = require('../config/catalog');
const {HttpError} = require('../utils/http');
const {escapeRegex} = require('./productService');
const refreshTokenService = require('./refreshTokenService');
const {LISTED_PRODUCT} = require('../utils/queryFilters');
const {runList} = require('../utils/listQuery');

const PAGE_SIZE = 15;

async function getDashboardStats() {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [
    customers,
    blockedCustomers,
    newCustomers,
    products,
    lowStock,
    outOfStock,
    recentCustomers,
    lowStockProducts,
  ] = await Promise.all([
    User.countDocuments({role: 'customer'}),
    User.countDocuments({role: 'customer', isBlocked: true}),
    User.countDocuments({role: 'customer', createdAt: {$gte: weekAgo}}),
    Product.countDocuments({...LISTED_PRODUCT}),
    Product.countDocuments({
      ...LISTED_PRODUCT,
      stock: {$gt: 0, $lte: RULES.lowStockLimit},
    }),
    Product.countDocuments({...LISTED_PRODUCT, stock: 0}),
    User.find({role: 'customer'}).sort({createdAt: -1}).limit(6).lean(),
    Product.find({...LISTED_PRODUCT, stock: {$lte: RULES.lowStockLimit}})
      .sort({stock: 1, name: 1})
      .limit(6)
      .select('name slug stock image category')
      .populate('category', 'name')
      .lean(),
  ]);

  return {
    stats: {
      customers,
      blockedCustomers,
      newCustomers,
      products,
      lowStock,
      outOfStock,
    },
    recentCustomers: recentCustomers.map(publicCustomer),
    lowStockProducts,
  };
}

function publicCustomer(user) {
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    phone: user.phone || '',
    isBlocked: Boolean(user.isBlocked),
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt || null,
  };
}

async function listCustomers(query = {}) {
  const result = await runList(User, query, {
    pageSize: PAGE_SIZE,
    defaultSort: 'newest',
    sorts: {
      newest: {label: 'Newest first', order: {createdAt: -1}},
      oldest: {label: 'Oldest first', order: {createdAt: 1}},
      name_asc: {label: 'Name: A to Z', order: {name: 1}},
      last_login: {label: 'Recently signed in', order: {lastLoginAt: -1}},
    },
    searchMax: 80,
    searchFields: ['name', 'email', 'phone'],
    baseFilter: {role: 'customer'},
    fields: {
      status: {
        values: ['active', 'blocked'],
        default: 'all',
        label: 'Status',
        match: (value) => ({isBlocked: value === 'blocked'}),
      },
    },
  });
  const {rows, ...list} = result;
  return {...list, customers: await customersWithWallets(rows)};
}
async function customersWithWallets(users) {
  const wallets = await Wallet.find({
    user: {$in: users.map((user) => user._id)},
  })
    .select('user balance')
    .lean();
  const balances = new Map(
    wallets.map((wallet) => [String(wallet.user), wallet.balance]),
  );
  return users.map((user) => ({
    ...publicCustomer(user),
    walletBalance: balances.get(String(user._id)) || 0,
  }));
}

// Only customers can be blocked, so an admin can never lock out another admin by mistake.
// Cash on Delivery off or on for one customer. The checkout refuses COD for them while it is off.
async function setCustomerCodBlocked(userId, codBlocked) {
  if (!mongoose.isValidObjectId(userId))
    throw new HttpError(404, 'Customer not found.');
  const user = await User.findOneAndUpdate(
    {_id: userId, role: 'customer'},
    {$set: {codBlocked}},
    {new: true},
  ).lean();
  if (!user) throw new HttpError(404, 'Customer not found.');
  return {...publicCustomer(user), codBlocked: Boolean(user.codBlocked)};
}

// Signs the customer out of every phone and browser: all their refresh tokens are revoked, so
// nothing can renew a session. Access tokens are short-lived and end on their own soon after.
async function signOutEverywhere(userId) {
  if (!mongoose.isValidObjectId(userId))
    throw new HttpError(404, 'Customer not found.');
  const user = await User.findOne({_id: userId, role: 'customer'})
    .select('_id name')
    .lean();
  if (!user) throw new HttpError(404, 'Customer not found.');
  await refreshTokenService.revokeAllForUser(user._id, 'admin_signout');
  return {id: String(user._id), name: user.name};
}

async function setCustomerBlocked(userId, isBlocked) {
  if (!mongoose.isValidObjectId(userId))
    throw new HttpError(404, 'Customer not found.');
  const user = await User.findOneAndUpdate(
    {_id: userId, role: 'customer'},
    {$set: {isBlocked}},
    {new: true},
  ).lean();
  if (!user) throw new HttpError(404, 'Customer not found.');
  // Blocking takes effect at once for pages and APIs (middleware/auth.js reads isBlocked on every
  // request), and revoking the refresh tokens means the browser cannot renew its way back in.
  if (isBlocked)
    await refreshTokenService.revokeAllForUser(user._id, 'blocked');
  return publicCustomer(user);
}

// ---------- Top bar: global search and the notification bell ----------

// Up to 5 orders, products and customers matching the text (order id, names, email or phone).
async function globalSearch(term) {
  const pattern = new RegExp(escapeRegex(term), 'i');
  const [orders, products, customers] = await Promise.all([
    Order.find({
      $or: [
        {orderId: pattern},
        {'address.fullName': pattern},
        {'address.phone': pattern},
      ],
    })
      .sort({createdAt: -1})
      .limit(5)
      .select('orderId total orderStatus createdAt address.fullName')
      .lean(),
    Product.find({$or: [{name: pattern}, {brand: pattern}]})
      .sort({name: 1})
      .limit(5)
      .select('name brand stock isListed image')
      .lean(),
    User.find({
      role: 'customer',
      isDeleted: {$ne: true},
      $or: [{name: pattern}, {email: pattern}, {phone: pattern}],
    })
      .sort({createdAt: -1})
      .limit(5)
      .select('name email phone isBlocked')
      .lean(),
  ]);
  return {
    orders: orders.map((o) => ({
      orderId: o.orderId,
      customer: (o.address && o.address.fullName) || '',
      total: o.total,
      status: o.orderStatus,
      createdAt: o.createdAt,
    })),
    products: products.map((p) => ({
      id: String(p._id),
      name: p.name,
      brand: p.brand || '',
      stock: p.stock,
      isListed: p.isListed !== false,
    })),
    customers: customers.map((c) => ({
      id: String(c._id),
      name: c.name,
      email: c.email,
      phone: c.phone || '',
      isBlocked: Boolean(c.isBlocked),
    })),
  };
}

// What needs the team's attention. Each item links to a section of the console (by key).
async function notifications(now = new Date()) {
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const [newOrders, toConfirm, returns, lowStock, outOfStock] =
    await Promise.all([
      Order.countDocuments({createdAt: {$gte: dayAgo}}),
      Order.countDocuments({orderStatus: 'placed'}),
      Order.countDocuments({orderStatus: 'return_requested'}),
      Product.countDocuments({
        ...LISTED_PRODUCT,
        stock: {$gt: 0, $lte: RULES.lowStockLimit},
      }),
      Product.countDocuments({...LISTED_PRODUCT, stock: 0}),
    ]);
  const items = [
    {
      key: 'new-orders',
      label: 'New orders in the last 24 hours',
      count: newOrders,
      section: 'orders',
      icon: 'package-check',
    },
    {
      key: 'to-confirm',
      label: 'Orders waiting to be confirmed',
      count: toConfirm,
      section: 'orders',
      icon: 'clock',
    },
    {
      key: 'returns',
      label: 'Return requests',
      count: returns,
      section: 'returns',
      icon: 'rotate-ccw',
    },
    {
      key: 'low-stock',
      label: 'Products low on stock',
      count: lowStock,
      section: 'products?status=low',
      icon: 'alert',
    },
    {
      key: 'out-of-stock',
      label: 'Products out of stock',
      count: outOfStock,
      section: 'products?status=out',
      icon: 'box',
    },
  ];
  // The badge counts what someone has to act on (new orders are only news).
  const total = toConfirm + returns + lowStock + outOfStock;
  return {items, total};
}

module.exports = {
  getDashboardStats,
  listCustomers,
  setCustomerBlocked,
  setCustomerCodBlocked,
  signOutEverywhere,
  globalSearch,
  notifications,
};
