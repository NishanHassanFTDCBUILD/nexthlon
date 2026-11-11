const rateLimit = require("express-rate-limit");

// Slows down password guessing: 20 failed sign-in or sign-up attempts per 15 minutes per IP address.
// Successful attempts are not counted.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  skipSuccessfulRequests: true,
  //Sends standard rate-limit information in HTTP response headers.
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { message: "Too many attempts. Please wait 15 minutes and try again." }
});

// Admin sign-in is stricter and counted on its own: 10 failed attempts per 15 minutes per IP.
const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { message: "Too many attempts. Please wait 15 minutes and try again." }
});

// Renewing a session: 60 per 15 minutes per IP. A normal browser renews every 15 minutes, so this
// is far above honest use, but it stops a script from hammering the endpoint with stolen tokens.
const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { message: "Too many session renewals. Please sign in again." }
});

// Contact form and newsletter: 8 messages per 15 minutes per IP address, so the inbox cannot be flooded.
const formLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { message: "Too many messages. Please wait a few minutes and try again." }
});

// Reviews: a customer can only write one per product anyway; this just stops scripted floods.
const reviewLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { message: "Too many reviews in a short time. Please try again later." }
});

// Sensitive account actions (change email or password, sign out everywhere, delete the account,
// support requests): 15 per 15 minutes for each signed-in account (or IP address).
const sensitiveLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 15,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: req => (req.user ? `user:${req.user._id}` : `ip:${req.ip}`),
  message: { message: "Too many changes in a short time. Please wait a few minutes and try again." }
});

// Admin changes (status updates, notes, shipments...): 300 per 15 minutes per admin.
const adminWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: req => (req.user ? `admin:${req.user._id}` : `ip:${req.ip}`),
  message: { message: "Too many changes in a short time. Please wait a few minutes." }
});

// Money and email actions (refunds, return approvals, cart reminders): 40 per 15 minutes per admin.
const adminMoneyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 40,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: req => (req.user ? `admin-money:${req.user._id}` : `ip:${req.ip}`),
  message: { message: "Too many refunds or emails in a short time. Please wait a few minutes." }
});

// Asking for a reset email: 5 per 15 minutes per address of the visitor. The account has its own limit
// on top (services/passwordResetService.js), so one inbox cannot be flooded from many addresses either.
const forgotLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { message: "Too many requests. Please wait 15 minutes and try again." }
});

// Using a reset or confirmation link: 15 per 15 minutes per visitor address (a real person needs one or two).
const linkLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 15,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { message: "Too many attempts. Please wait 15 minutes and try again." }
});

// The code after the admin password: 10 per 15 minutes per visitor address. The account has its own
// lock on top (5 wrong codes, then 15 minutes), which follows the account whatever address guesses come from.
const twoFactorLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { message: "Too many attempts. Please wait 15 minutes and try again." }
});

module.exports = { forgotLimiter, linkLimiter, twoFactorLimiter, authLimiter, adminLoginLimiter, refreshLimiter, formLimiter, reviewLimiter, sensitiveLimiter, adminWriteLimiter, adminMoneyLimiter };
