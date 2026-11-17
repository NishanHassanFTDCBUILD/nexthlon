const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const User = require("../models/User");
const Order = require("../models/Order");
const StockAlert = require("../models/StockAlert");
const Product = require("../models/Product");
const Review = require("../models/Review");
const Coupon = require("../models/Coupon");
const CouponRedemption = require("../models/CouponRedemption");
const LoginActivity = require("../models/LoginActivity");
const WalletTransaction = require("../models/WalletTransaction");
const walletService = require("./walletService");
const wishlistService = require("./wishlistService");
const couponService = require("./couponService");
const referralService = require("./referralService");
const auditService = require("./auditService");
const refreshTokenService = require("./refreshTokenService");
const { browserName } = require("../utils/device");
const { HttpError } = require("../utils/http");
const { LISTED_PRODUCT } = require("../utils/queryFilters");

// My Account > Recently viewed shows the last 5 products.
const RECENT_LIMIT = 5;
const LOGIN_HISTORY = 10;
const OPEN_STATUSES = ["placed", "confirmed", "shipped", "out_for_delivery"];

const toId = id => new mongoose.Types.ObjectId(String(id));

// ---------- Sign-in history ----------

// "Chrome on Windows" lives in utils/device.js now, so the devices list names a device the same way.

// Stores one sign-in and keeps only the latest LOGIN_HISTORY for the account.
async function recordLogin(userId, { userAgent = "", ip = "" } = {}) {
  await LoginActivity.create({ user: userId, browser: browserName(userAgent), ip: auditService.maskIp(ip) });
  const old = await LoginActivity.find({ user: userId }).sort({ at: -1, _id: -1 }).skip(LOGIN_HISTORY).select("_id").lean();
  if (old.length) await LoginActivity.deleteMany({ _id: { $in: old.map(row => row._id) } });
}

function loginActivity(userId) {
  return LoginActivity.find({ user: userId }).sort({ at: -1, _id: -1 }).limit(LOGIN_HISTORY).lean();
}

// ---------- Recently viewed ----------

// The product moves to the front; the list keeps the newest RECENT_LIMIT.
async function recordView(userId, productId) {
  if (!mongoose.isValidObjectId(productId)) return;
  const product = toId(productId);
  await User.updateOne({ _id: userId }, { $pull: { recentlyViewed: { product } } });
  await User.updateOne({ _id: userId }, {
    $push: { recentlyViewed: { $each: [{ product, at: new Date() }], $position: 0, $slice: RECENT_LIMIT } }
  });
}

// Listed products only, newest first.
async function recentlyViewed(userId, limit = RECENT_LIMIT) {
  const user = await User.findById(userId).select("recentlyViewed").lean();
  const ids = (user && user.recentlyViewed ? user.recentlyViewed : []).map(entry => String(entry.product));
  if (!ids.length) return [];
  const products = await Product.find({ _id: { $in: ids }, ...LISTED_PRODUCT }).lean();
  const byId = new Map(products.map(product => [String(product._id), product]));
  return ids.map(id => byId.get(id)).filter(Boolean).slice(0, limit);
}

async function clearRecent(userId) {
  await User.updateOne({ _id: userId }, { $set: { recentlyViewed: [] } });
}

// ---------- Preferences ----------

async function updatePreferences(userId, prefs) {
  const set = Object.fromEntries(Object.entries(prefs).map(([key, value]) => [`notifyPrefs.${key}`, value]));
  const user = await User.findByIdAndUpdate(userId, { $set: set }, { new: true }).select("notifyPrefs").lean();
  if (!user) throw new HttpError(404, "Account not found.");
  return user.notifyPrefs;
}

// ---------- Sign-in email, sign out everywhere, delete account ----------

async function checkPassword(userId, password, field = "password") {
  const user = await User.findById(userId).select("+passwordHash");
  if (!user) throw new HttpError(404, "Account not found.");
  if (!(await bcrypt.compare(password, user.passwordHash))) {
    throw new HttpError(400, "Your password is incorrect.", { [field]: "Your password is incorrect." });
  }
  return user;
}

async function changeEmail(userId, { email, password }, context = {}) {
  const user = await checkPassword(userId, password);
  if (user.email === email) throw new HttpError(400, "That is already your sign-in email.", { email: "That is already your sign-in email." });
  if (await User.exists({ email, _id: { $ne: user._id } })) {
    throw new HttpError(409, "Another account already uses this email.", { email: "Another account already uses this email." });
  }
  const before = user.email;
  user.email = email;
  // The new address has to be confirmed again (the controller sends the link).
  user.emailVerifiedAt = null;
  try {
    await user.save();
  } catch (error) {
    if (error.code === 11000) throw new HttpError(409, "Another account already uses this email.", { email: "Another account already uses this email." });
    throw error;
  }
  await auditService.record({ ...context, action: "account.email_changed", target: `user:${user._id}`, before: { email: before }, after: { email } });
  return user;
}

// Two steps, because a login has two halves. Raising tokenVersion makes every access token
// invalid at once (middleware/auth.js checks it), and revoking the refresh tokens means no device
// can quietly renew itself afterwards.
async function logoutEverywhere(userId, context = {}) {
  const user = await User.findByIdAndUpdate(userId, { $inc: { tokenVersion: 1 } }, { new: true });
  if (!user) throw new HttpError(404, "Account not found.");
  await refreshTokenService.revokeAllForUser(user._id, "logout_all");
  await auditService.record({ ...context, action: "account.logout_all", target: `user:${user._id}` });
  return user;
}

// The "Logged-in devices" list on the security page: one row per live refresh token.
function sessions(userId, currentFamilyId = "") {
  return refreshTokenService.listSessions(userId, currentFamilyId);
}

// "Log out this device": that device's whole refresh family is revoked, so it cannot renew.
async function endSession(userId, sessionId, currentFamilyId = "", context = {}) {
  const result = await refreshTokenService.revokeSession(userId, sessionId, currentFamilyId);
  if (!result) throw new HttpError(404, "That device is not signed in to your account.");
  await auditService.record({ ...context, action: "account.device_logout", target: `user:${userId}`, after: { device: result.device } });
  return result;
}

// Soft delete: the account can never sign in again and every token stops working, but orders,
// invoices and reviews stay for the store's records.
async function deleteAccount(userId, password, context = {}) {
  const user = await checkPassword(userId, password);
  user.isDeleted = true;
  user.deletedAt = new Date();
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  user.recentlyViewed = [];
  await user.save();
  await refreshTokenService.revokeAllForUser(user._id, "account_deleted");
  // Back-in-stock alerts hold only the email address: nothing left to send them for (E3).
  await StockAlert.deleteMany({ email: user.email });
  await auditService.record({ ...context, action: "account.deleted", target: `user:${user._id}`, after: { deletedAt: user.deletedAt } });
  return user;
}

// ---------- Overview ----------

async function lastOrder(userId) {
  return Order.findOne({ user: userId }).sort({ createdAt: -1 }).select("orderId orderStatus items createdAt total deliveredAt").lean();
}

// Products to suggest: more from the sports the customer has bought or viewed, else the best rated.
async function recommendations(userId, exclude = [], limit = 6) {
  const [orders, recent] = await Promise.all([
    Order.find({ user: userId }).sort({ createdAt: -1 }).limit(5).select("items.product").lean(),
    recentlyViewed(userId, 6)
  ]);
  const seenIds = new Set([...exclude.map(String), ...orders.flatMap(order => order.items.map(item => String(item.product)))]);
  const productIds = [...seenIds].filter(mongoose.isValidObjectId);
  const bought = await Product.find({ _id: { $in: productIds } }).select("category").lean();
  const categories = [...new Set([...bought, ...recent].map(product => String(product.category)).filter(Boolean))];
  const filter = { ...LISTED_PRODUCT, stock: { $gt: 0 }, _id: { $nin: productIds } };
  let picks = categories.length
    ? await Product.find({ ...filter, category: { $in: categories } }).sort({ ratingAverage: -1, discountPercent: -1 }).limit(limit).lean()
    : [];
  if (picks.length < limit) {
    const more = await Product.find({ ...filter, _id: { $nin: [...productIds, ...picks.map(p => p._id)] } })
      .sort({ ratingCount: -1, discountPercent: -1 }).limit(limit - picks.length).lean();
    picks = picks.concat(more);
  }
  return picks;
}

async function overview(user) {
  const userId = user._id;
  const [orderCount, openOrders, balance, wishCount, coupons, reviewCount, latest, recent] = await Promise.all([
    Order.countDocuments({ user: userId }),
    Order.countDocuments({ user: userId, orderStatus: { $in: OPEN_STATUSES } }),
    walletService.getBalance(userId),
    wishlistService.countItems(userId),
    couponService.listAvailable(userId, 0),
    Review.countDocuments({ user: userId }),
    lastOrder(userId),
    recentlyViewed(userId, RECENT_LIMIT)
  ]);
  const recommended = await recommendations(userId, recent.map(p => p._id), 6);
  return {
    stats: { orders: orderCount, openOrders, wallet: balance, wishlist: wishCount, coupons: coupons.length, reviews: reviewCount },
    lastOrder: latest,
    recent,
    recommended
  };
}

// ---------- Buy it again ----------

// Every product the customer has had delivered, most recent first, with today's price.
async function buyAgain(userId) {
  const rows = await Order.aggregate([
    { $match: { user: toId(userId) } },
    { $unwind: "$items" },
    { $match: { "items.status": "delivered" } },
    { $sort: { createdAt: -1 } },
    { $group: { _id: "$items.product", lastBought: { $first: "$createdAt" }, times: { $sum: "$items.quantity" }, orderId: { $first: "$orderId" } } },
    { $sort: { lastBought: -1 } },
    { $limit: 60 }
  ]);
  if (!rows.length) return [];
  const products = await Product.find({ _id: { $in: rows.map(row => row._id) } }).lean();
  const byId = new Map(products.map(product => [String(product._id), product]));
  return rows
    .map(row => ({ product: byId.get(String(row._id)), lastBought: row.lastBought, times: row.times, orderId: row.orderId }))
    .filter(row => row.product)
    .map(row => ({ ...row, item: wishlistService.toWishItem(row.product) }));
}

// ---------- Coupons ----------

async function coupons(userId, now = new Date()) {
  const [available, redemptions, expired] = await Promise.all([
    couponService.listAvailable(userId, 0, now),
    CouponRedemption.find({ user: userId }).sort({ createdAt: -1 }).limit(30).lean(),
    Coupon.find({ isActive: true, endsAt: { $ne: null, $lt: now } }).sort({ endsAt: -1 }).limit(10).lean()
  ]);
  const orderIds = redemptions.map(row => row.order);
  const orders = await Order.find({ _id: { $in: orderIds }, user: userId }).select("orderId").lean();
  const orderOf = new Map(orders.map(order => [String(order._id), order.orderId]));
  return {
    available,
    used: redemptions.map(row => ({ code: row.code, discount: row.discount, usedAt: row.createdAt, orderId: orderOf.get(String(row.order)) || "" })),
    expired: expired.map(coupon => couponService.toPublicCoupon(coupon, { problem: "Expired" }))
  };
}

// ---------- Referral ----------

async function referral(user, baseUrl = "") {
  const [details, friends, earned] = await Promise.all([
    referralService.getReferral(user, baseUrl),
    // Only a first name and the join date of each friend: never their email.
    User.find({ referredBy: user._id }).sort({ createdAt: -1 }).limit(20).select("name createdAt").lean(),
    WalletTransaction.aggregate([
      { $match: { user: toId(user._id), kind: "referral", type: "credit" } },
      { $group: { _id: null, amount: { $sum: "$amount" }, count: { $sum: 1 } } }
    ])
  ]);
  return {
    ...details,
    friends: friends.map(friend => ({ firstName: String(friend.name || "Friend").split(" ")[0], joinedAt: friend.createdAt })),
    earned: earned[0] ? earned[0].amount : 0
  };
}

module.exports = {
  RECENT_LIMIT,
  LOGIN_HISTORY,
  OPEN_STATUSES,
  browserName,
  recordLogin,
  loginActivity,
  recordView,
  recentlyViewed,
  clearRecent,
  updatePreferences,
  checkPassword,
  changeEmail,
  logoutEverywhere,
  sessions,
  endSession,
  deleteAccount,
  overview,
  recommendations,
  buyAgain,
  coupons,
  referral
};
