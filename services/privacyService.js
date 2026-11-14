// "Download my data" (D2): everything the store keeps about one customer, as one JSON file.
// Secrets never leave: no password hash, token versions, two-step secrets or refresh tokens.
// Money is in paise, as stored, and the file says so.
const User = require("../models/User");
const Address = require("../models/Address");
const Order = require("../models/Order");
const Review = require("../models/Review");
const Wishlist = require("../models/Wishlist");
const ShoppingList = require("../models/ShoppingList");
const SupportTicket = require("../models/SupportTicket");
const Wallet = require("../models/Wallet");
const WalletTransaction = require("../models/WalletTransaction");
const LoginActivity = require("../models/LoginActivity");
const NewsletterSubscriber = require("../models/NewsletterSubscriber");
const auditService = require("./auditService");
const { HttpError } = require("../utils/http");

// Internal bookkeeping fields that mean nothing to the customer.
const DROP = new Set(["__v", "user", "tokenVersion", "twoFactor", "passwordHash", "key", "isDeleted"]);

function clean(value) {
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === "object") {
    if (value instanceof Date) return value.toISOString();
    if (value._bsontype === "ObjectId" || value._bsontype === "ObjectID") return String(value);
    const out = {};
    for (const [key, inner] of Object.entries(value)) {
      if (!DROP.has(key)) out[key] = clean(inner);
    }
    return out;
  }
  return value;
}

async function exportData(userId, context = {}) {
  const user = await User.findById(userId).select("name email phone role referralCode notifyPrefs recentlyViewed emailVerifiedAt lastLoginAt createdAt").lean();
  if (!user) throw new HttpError(404, "Account not found.");
  const [addresses, orders, reviews, wishlist, lists, tickets, wallet, walletHistory, signIns, newsletter] = await Promise.all([
    Address.find({ user: userId }).lean(),
    // Staff notes on an order are internal and stay out.
    Order.find({ user: userId }).sort({ createdAt: -1 }).select("-notes").lean(),
    Review.find({ user: userId }).lean(),
    Wishlist.findOne({ user: userId }).lean(),
    ShoppingList.find({ user: userId }).lean(),
    SupportTicket.find({ user: userId }).lean(),
    Wallet.findOne({ user: userId }).lean(),
    WalletTransaction.find({ user: userId }).sort({ createdAt: -1 }).lean(),
    LoginActivity.find({ user: userId }).sort({ at: -1 }).limit(50).lean(),
    NewsletterSubscriber.findOne({ email: user.email }).select("email createdAt").lean()
  ]);
  await auditService.record({ ...context, action: "account.data_export", target: `user:${userId}` });
  return {
    about: "Your Nexthlon data. Amounts are in paise (100 paise = 1 rupee). Dates are in UTC.",
    exportedAt: new Date().toISOString(),
    account: clean(user),
    addresses: clean(addresses),
    orders: clean(orders),
    reviews: clean(reviews),
    wishlist: clean(wishlist ? wishlist.products : []),
    lists: clean(lists),
    supportTickets: clean(tickets),
    wallet: { balance: wallet ? wallet.balance || 0 : 0, history: clean(walletHistory) },
    recentSignIns: clean(signIns),
    newsletter: newsletter ? { email: newsletter.email, since: clean(newsletter.createdAt) } : null
  };
}

module.exports = { exportData, clean };
