// "Download my data" (D2): everything the store keeps about one customer, as one JSON file.
const crypto = require('crypto');
// Secrets never leave: no password hash, token versions, two-step secrets or refresh tokens.
// Money is in paise, as stored, and the file says so.
const User = require('../models/User');
const Address = require('../models/Address');
const Order = require('../models/Order');
const Review = require('../models/Review');
const Wishlist = require('../models/Wishlist');
const ShoppingList = require('../models/ShoppingList');
const SupportTicket = require('../models/SupportTicket');
const Wallet = require('../models/Wallet');
const WalletTransaction = require('../models/WalletTransaction');
const LoginActivity = require('../models/LoginActivity');
const NewsletterSubscriber = require('../models/NewsletterSubscriber');
const StockAlert = require('../models/StockAlert');
const auditService = require('./auditService');
const {HttpError} = require('../utils/http');

// Internal bookkeeping fields that mean nothing to the customer.
const DROP = new Set([
  '__v',
  'user',
  'tokenVersion',
  'twoFactor',
  'passwordHash',
  'key',
  'isDeleted',
]);

function clean(value) {
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === 'object') {
    if (value instanceof Date) return value.toISOString();
    if (value._bsontype === 'ObjectId' || value._bsontype === 'ObjectID')
      return String(value);
    const out = {};
    for (const [key, inner] of Object.entries(value)) {
      if (!DROP.has(key)) out[key] = clean(inner);
    }
    return out;
  }
  return value;
}

async function exportData(userId, context = {}) {
  const user = await User.findById(userId)
    .select(
      'name email phone role referralCode notifyPrefs recentlyViewed emailVerifiedAt lastLoginAt createdAt',
    )
    .lean();
  if (!user) throw new HttpError(404, 'Account not found.');
  const [
    addresses,
    orders,
    reviews,
    wishlist,
    lists,
    tickets,
    wallet,
    walletHistory,
    signIns,
    newsletter,
    alerts,
  ] = await Promise.all([
    Address.find({user: userId}).lean(),
    // Staff notes on an order are internal and stay out.
    Order.find({user: userId}).sort({createdAt: -1}).select('-notes').lean(),
    Review.find({user: userId}).lean(),
    Wishlist.findOne({user: userId}).lean(),
    ShoppingList.find({user: userId}).lean(),
    SupportTicket.find({user: userId}).lean(),
    Wallet.findOne({user: userId}).lean(),
    WalletTransaction.find({user: userId}).sort({createdAt: -1}).lean(),
    LoginActivity.find({user: userId}).sort({at: -1}).limit(50).lean(),
    NewsletterSubscriber.findOne({email: user.email})
      .select('email createdAt')
      .lean(),
    StockAlert.find({email: user.email})
      .select('product variant notifiedAt createdAt')
      .lean(),
  ]);
  await auditService.record({
    ...context,
    action: 'account.data_export',
    target: `user:${userId}`,
  });
  return {
    about:
      'Your Nexthlon data. Amounts are in paise (100 paise = 1 rupee). Dates are in UTC.',
    exportedAt: new Date().toISOString(),
    account: clean(user),
    addresses: clean(addresses),
    orders: clean(orders),
    reviews: clean(reviews),
    wishlist: clean(wishlist ? wishlist.products : []),
    lists: clean(lists),
    supportTickets: clean(tickets),
    wallet: {
      balance: wallet ? wallet.balance || 0 : 0,
      history: clean(walletHistory),
    },
    recentSignIns: clean(signIns),
    backInStockAlerts: clean(alerts),
    newsletter: newsletter
      ? {email: newsletter.email, since: clean(newsletter.createdAt)}
      : null,
  };
}

// Team action on a customer's request to remove their personal details. The account stays (so its
// orders, invoices and tax records stay correct) but the name, email, phone, addresses, saved lists, sign-in
// history and push devices are removed. The account is switched off and cannot sign in again.
// Orders keep their address snapshot, because invoices and GST records must keep it by law.
async function anonymise(userId, context = {}) {
  const user = await User.findById(userId).select('_id role').lean();
  if (!user || user.role !== 'customer')
    throw new HttpError(404, 'Customer not found.');
  const id = String(user._id);
  const hash = crypto
    .createHash('sha256')
    .update(id)
    .digest('hex')
    .slice(0, 12);
  await Promise.all([
    Address.deleteMany({user: user._id}),
    Wishlist.deleteMany({user: user._id}),
    ShoppingList.deleteMany({user: user._id}),
    LoginActivity.deleteMany({user: user._id}),
    require('../models/RefreshToken').deleteMany({user: user._id}),
    require('../models/PushSubscription').deleteMany({user: user._id}),
  ]);
  await User.updateOne(
    {_id: user._id},
    {
      $set: {
        name: 'Former customer',
        email: `removed-${hash}@anonymised.invalid`,
        phone: '',
        isBlocked: true,
        adminNote: '',
        recentlyViewed: [],
        emailVerifiedAt: null,
      },
      $unset: {verifiedPhones: 1},
    },
  );
  await auditService.record({
    ...context,
    action: 'customer.anonymised',
    target: `user:${id}`,
  });
  return {
    id,
    message: 'Personal details removed. Orders and invoices are kept.',
  };
}

module.exports = {exportData, clean, anonymise};
