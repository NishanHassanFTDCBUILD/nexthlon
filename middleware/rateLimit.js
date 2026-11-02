const rateLimit = require("express-rate-limit");

// Slows down password guessing: 20 failed sign-in or sign-up attempts per 15 minutes per IP address.
// Successful attempts are not counted.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  skipSuccessfulRequests: true,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { message: "Too many attempts. Please wait 15 minutes and try again." }
});

module.exports = { authLimiter };
