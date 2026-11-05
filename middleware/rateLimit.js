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

module.exports = { authLimiter, adminLoginLimiter, formLimiter, reviewLimiter, sensitiveLimiter };
