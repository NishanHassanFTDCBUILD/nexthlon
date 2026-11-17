const rateLimit = require("express-rate-limit");
const redis = require("../providers/redis");
const { SharedStore } = require("./rateLimitStore");

// Every limiter has a fixed name. With Redis (REDIS_URL) its counts are shared by every copy of the store
// (middleware/rateLimitStore.js), so a visitor cannot get more tries by landing on another server.
// Without Redis each copy counts on its own, as before.
const limiter = (name, options) => rateLimit(redis.enabled() ? { ...options, store: new SharedStore(name) } : options);

// Slows down password guessing: 20 failed sign-in or sign-up attempts per 15 minutes per IP address.
// Successful attempts are not counted.
const authLimiter = limiter("auth", {
  windowMs: 15 * 60 * 1000,
  limit: 20,
  skipSuccessfulRequests: true,
  //Sends standard rate-limit information in HTTP response headers.
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { message: "Too many attempts. Please wait 15 minutes and try again." }
});

// Admin sign-in is stricter and counted on its own: 10 failed attempts per 15 minutes per IP.
const adminLoginLimiter = limiter("adminLogin", {
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { message: "Too many attempts. Please wait 15 minutes and try again." }
});

// One account under attack from many addresses (D3): 10 failed sign-ins per 15 minutes per email
// address, wherever they come from. Counted next to the per-IP limits above; a correct password is not
// counted, so the owner signing in normally is never slowed.
const accountKey = req => {
  const email = req.body && typeof req.body.email === "string" ? req.body.email.trim().toLowerCase().slice(0, 254) : "";
  return email ? `email:${email}` : `ip:${req.ip}`;
};
const accountLoginLimiter = limiter("accountLogin", {
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  keyGenerator: accountKey,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { message: "Too many sign-in attempts for this account. Please wait 15 minutes, or reset your password." }
});

// Search and product lookups (D3): 600 per 15 minutes per address. Far above real typing (suggestions
// are debounced), but it stops a script from running thousands of database searches. Generous on purpose:
// many Indian mobile users share one address through their carrier.
const searchLimiter = limiter("search", {
  windowMs: 15 * 60 * 1000,
  limit: 600,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { message: "Too many searches in a short time. Please wait a minute and try again." }
});

// Renewing a session: 60 per 15 minutes per IP. A normal browser renews every 15 minutes, so this
// is far above honest use, but it stops a script from hammering the endpoint with stolen tokens.
const refreshLimiter = limiter("refresh", {
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { message: "Too many session renewals. Please sign in again." }
});

// Contact form and newsletter: 8 messages per 15 minutes per IP address, so the inbox cannot be flooded.
const formLimiter = limiter("form", {
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { message: "Too many messages. Please wait a few minutes and try again." }
});

// Reviews: a customer can only write one per product anyway; this just stops scripted floods.
const reviewLimiter = limiter("review", {
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { message: "Too many reviews in a short time. Please try again later." }
});

// Sensitive account actions (change email or password, sign out everywhere, delete the account,
// support requests): 15 per 15 minutes for each signed-in account (or IP address).
const sensitiveLimiter = limiter("sensitive", {
  windowMs: 15 * 60 * 1000,
  limit: 15,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: req => (req.user ? `user:${req.user._id}` : `ip:${req.ip}`),
  message: { message: "Too many changes in a short time. Please wait a few minutes and try again." }
});

// Admin changes (status updates, notes, shipments...): 300 per 15 minutes per admin.
const adminWriteLimiter = limiter("adminWrite", {
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: req => (req.user ? `admin:${req.user._id}` : `ip:${req.ip}`),
  message: { message: "Too many changes in a short time. Please wait a few minutes." }
});

// Money and email actions (refunds, return approvals, cart reminders): 40 per 15 minutes per admin.
const adminMoneyLimiter = limiter("adminMoney", {
  windowMs: 15 * 60 * 1000,
  limit: 40,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: req => (req.user ? `admin-money:${req.user._id}` : `ip:${req.ip}`),
  message: { message: "Too many refunds or emails in a short time. Please wait a few minutes." }
});

// Asking for a reset email: 5 per 15 minutes per address of the visitor. The account has its own limit
// on top (services/passwordResetService.js), so one inbox cannot be flooded from many addresses either.
const forgotLimiter = limiter("forgot", {
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { message: "Too many requests. Please wait 15 minutes and try again." }
});

// Using a reset or confirmation link: 15 per 15 minutes per visitor address (a real person needs one or two).
const linkLimiter = limiter("link", {
  windowMs: 15 * 60 * 1000,
  limit: 15,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { message: "Too many attempts. Please wait 15 minutes and try again." }
});

// PIN code lookups call India Post for the shopper. 60 in 15 minutes is plenty for typing addresses,
// and stops anyone using the store as a free proxy.
const pincodeLimiter = limiter("pincode", {
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { message: "Too many PIN code lookups. Type the city and state yourself, or try again in a few minutes." }
});

// Cart changes: 150 per 15 minutes per IP address. Far above any real shopper (each tap is one change),
// but guests can make carts without an account, so a script cannot fill the database with them.
const cartLimiter = limiter("cart", {
  windowMs: 15 * 60 * 1000,
  limit: 150,
  skip: req => req.method === "GET",
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { message: "Too many cart changes. Please wait a few minutes and try again." }
});

// Placing orders and starting payments: 20 per 10 minutes per customer account. A sale rush is many
// customers, not one customer many times; this stops a script or a stuck button hammering checkout.
const orderLimiter = limiter("order", {
  windowMs: 10 * 60 * 1000,
  limit: 20,
  keyGenerator: req => (req.user ? `user:${req.user._id}` : req.ip),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { message: "Too many orders in a short time. Please wait a few minutes and try again." }
});

// Back-in-stock alerts (E3): a person asks for a handful; a script filling the table is stopped.
const stockAlertLimiter = limiter("stock-alert", {
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { message: "Too many alerts asked for. Try again in an hour." }
});

module.exports = { stockAlertLimiter, accountLoginLimiter, searchLimiter, orderLimiter, cartLimiter, pincodeLimiter, forgotLimiter, linkLimiter, authLimiter, adminLoginLimiter, refreshLimiter, formLimiter, reviewLimiter, sensitiveLimiter, adminWriteLimiter, adminMoneyLimiter };
