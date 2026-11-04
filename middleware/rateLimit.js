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

// Contact form and newsletter: 8 messages per 15 minutes per IP address, so the inbox cannot be flooded.
const formLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { message: "Too many messages. Please wait a few minutes and try again." }
});

module.exports = { authLimiter, formLimiter };
