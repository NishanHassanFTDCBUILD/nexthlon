// System status: one page that answers "is the store healthy, and what is switched on?".
//
// Everything here is read-only and safe to show. Secrets are never included: for each optional
// service the page says only whether it is configured, never the keys themselves.
const mongoose = require('mongoose');
const os = require('os');
const config = require('../config/env');
const razorpayService = require('./razorpayService');
const mailService = require('./mailService');
const Order = require('../models/Order');
const Product = require('../models/Product');
const User = require('../models/User');
const Cart = require('../models/Cart');
const Coupon = require('../models/Coupon');
const RefreshToken = require('../models/RefreshToken');

const CONNECTION_STATES = [
  'Disconnected',
  'Connected',
  'Connecting',
  'Disconnecting',
  'Uninitialised',
];

// Reads package.json once, for the app version and the libraries the project is built on.
const pkg = require('../package.json');

function duration(ms) {
  const seconds = Math.floor(ms / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m ${seconds % 60}s`;
}

// Is the database reachable right now, and how long does a round trip take?
async function database() {
  const state = mongoose.connection.readyState;
  const row = {
    state: CONNECTION_STATES[state] || 'Unknown',
    ok: state === 1,
    name: mongoose.connection.name || '',
    pingMs: null,
  };
  if (!row.ok) return row;
  const started = Date.now();
  try {
    await mongoose.connection.db.admin().command({ping: 1});
    row.pingMs = Date.now() - started;
  } catch (error) {
    row.ok = false;
    row.state = 'Ping failed';
  }
  return row;
}

// How much data there is. Cheap estimates are not used: these are exact counts, and the
// collections are small enough for that to be fine.
async function counts() {
  const [orders, products, customers, carts, coupons, sessions] =
    await Promise.all([
      Order.estimatedDocumentCount(),
      Product.estimatedDocumentCount(),
      User.countDocuments({role: 'customer'}),
      Cart.estimatedDocumentCount(),
      Coupon.countDocuments({isDeleted: {$ne: true}}),
      RefreshToken.countDocuments({
        revoked: false,
        expiresAt: {$gt: new Date()},
      }),
    ]);
  return [
    {label: 'Orders', value: orders, section: 'orders'},
    {label: 'Products', value: products, section: 'products'},
    {label: 'Customers', value: customers, section: 'customers'},
    {label: 'Live carts', value: carts, section: 'abandoned-carts'},
    {label: 'Coupons', value: coupons, section: 'coupons'},
    {label: 'Signed-in devices', value: sessions, section: ''},
  ];
}

// The optional services. "configured" only ever means "the keys are present".
function features() {
  return [
    {
      key: 'razorpay',
      label: 'Online payments (Razorpay)',
      on: razorpayService.isEnabled(),
      detail: razorpayService.isEnabled()
        ? 'Keys are set, so card and UPI payments are offered at checkout.'
        : 'No keys set, so checkout offers Cash on Delivery and the wallet only.',
    },
    {
      key: 'mail',
      label: 'Email (SMTP)',
      on: mailService.isConfigured(),
      detail: mailService.isConfigured()
        ? 'Order emails and cart reminders are sent.'
        : 'No SMTP host set, so emails are written to the server log instead of being sent.',
    },
    {
      key: 'cookieSecure',
      label: 'Secure cookies',
      on: config.cookieSecure,
      detail: config.cookieSecure
        ? 'Cookies are sent over HTTPS only.'
        : 'Off, which is right for http://localhost but must be on in production.',
    },
    {
      key: 'production',
      label: 'Production mode',
      on: config.isProduction,
      detail: config.isProduction
        ? 'NODE_ENV is production.'
        : 'Running in development mode.',
    },
  ];
}

// The session rules in force, so an admin can see them without reading .env.
function session() {
  return [
    {
      label: 'Access token',
      value: config.accessExpiresIn,
      hint: 'The short-lived JWT in the login cookie.',
    },
    {
      label: 'Customer refresh token',
      value: config.refreshExpiresIn,
      hint: 'How long a customer stays signed in without typing their password.',
    },
    {
      label: 'Admin refresh token',
      value: config.adminRefreshExpiresIn,
      hint: 'The same for this console.',
    },
  ];
}

async function status(now = new Date()) {
  const [db, totals] = await Promise.all([database(), counts()]);
  return {
    checkedAt: now,
    app: {
      name: pkg.name,
      version: pkg.version,
      node: process.version,
      mongoose: mongoose.version,
      platform: `${os.type()} ${os.release()}`,
      uptime: duration(process.uptime() * 1000),
      memoryMb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
    },
    database: db,
    counts: totals,
    features: features(),
    session: session(),
    // Green only when the database answers; everything else is information, not a fault.
    healthy: db.ok,
  };
}

module.exports = {duration, database, counts, features, session, status};
