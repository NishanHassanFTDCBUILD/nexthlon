require("dotenv").config();

const DURATION = /^(\d{1,4})([smhd])$/;
const UNIT_MS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

function durationToMs(value) {
  const [, count, unit] = value.match(DURATION);
  return Number(count) * UNIT_MS[unit];
}

// Reads a lifetime like "15m" or "7d" from .env, with a default and a largest allowed value.
function readDuration(name, fallback, limit) {
  const value = (process.env[name] || "").trim() || fallback;
  if (!DURATION.test(value) || durationToMs(value) > durationToMs(limit)) {
    throw new Error(`${name} must look like 15m, 12h or 7d, and be ${limit} or less. The default is ${fallback}.`);
  }
  return value;
}

function readConfig() {
  const isProduction = process.env.NODE_ENV === "production";

  const mongoUri = process.env.MONGODB_URI || "";
  if (!mongoUri) {
    throw new Error("MONGODB_URI is missing. Copy .env.example to .env and set it.");
  }

  const jwtSecret = process.env.JWT_SECRET || "";
  if (Buffer.byteLength(jwtSecret) < 32) {
    throw new Error("JWT_SECRET must be at least 32 characters. See .env.example for how to make one.");
  }

  // The access token is deliberately short-lived: it cannot be withdrawn once issued, so it must
  // run out quickly. The refresh token is the long-lived one, and that one CAN be revoked
  // (see models/RefreshToken.js), which is why it may live for days.
  const accessExpiresIn = readDuration("ACCESS_TOKEN_EXPIRES_IN", "15m", "1h");
  const refreshExpiresIn = readDuration("REFRESH_TOKEN_EXPIRES_IN", "7d", "30d");
  // Admin sessions are shorter than customer ones, because an admin can do more harm.
  const adminRefreshExpiresIn = readDuration("ADMIN_REFRESH_TOKEN_EXPIRES_IN", "1d", "7d");

  return {
    isProduction,
    port: Number(process.env.PORT) || 3000,
    mongoUri,
    jwtSecret,
    // Access token (the JWT in nx_token / nx_admin): the same short life for both sessions.
    accessExpiresIn,
    accessExpiresInMs: durationToMs(accessExpiresIn),
    // Refresh token (the random string in nx_refresh / nx_admin_refresh).
    refreshExpiresIn,
    refreshExpiresInMs: durationToMs(refreshExpiresIn),
    adminRefreshExpiresIn,
    adminRefreshExpiresInMs: durationToMs(adminRefreshExpiresIn),
    // Browsers only send Secure cookies over HTTPS, so this stays off for http://localhost.
    cookieSecure: isProduction || process.env.COOKIE_SECURE === "true",
    // Online payments (Razorpay). Optional: without the keys the store still runs, and the
    // online payment option shows as unavailable. The secrets never leave the server.
    razorpay: readRazorpay(),
    // The admin console lives under a private path (ADMIN_PATH, e.g. /nx-console-7f3k).
    adminPath: readAdminPath(),
    // Email (order emails, cart reminders, campaigns). Optional: without SMTP the emails are
    // written to the console in development. The values are never logged.
    mail: readMail()
  };
}

function readMail() {
  const host = (process.env.SMTP_HOST || "").trim();
  const port = Number(process.env.SMTP_PORT) || 587;
  const user = (process.env.SMTP_USER || "").trim();
  const pass = process.env.SMTP_PASS || "";
  const from = (process.env.MAIL_FROM || "").trim() || (user ? `Nexthlon <${user}>` : "Nexthlon <no-reply@localhost>");
  return { host, port, user, pass, from, secure: port === 465, enabled: Boolean(host) };
}

// Paths the store already uses can't be the admin path.
const RESERVED_PATHS = ["/api", "/account", "/products", "/cart", "/checkout", "/orders", "/login", "/signup", "/wallet",
  "/profile", "/wishlist", "/lists", "/css", "/js", "/img", "/uploads", "/about", "/contact", "/privacy", "/terms"];

function readAdminPath() {
  const raw = (process.env.ADMIN_PATH || "/admin").trim().replace(/\/+$/, "");
  const path = (raw.startsWith("/") ? raw : `/${raw}`).toLowerCase();
  if (!/^\/[a-z0-9_-]{3,64}$/.test(path)) {
    throw new Error("ADMIN_PATH must be one path segment of 3 to 64 letters, numbers, - or _ (for example /nx-console-7f3k).");
  }
  if (RESERVED_PATHS.includes(path)) throw new Error("ADMIN_PATH can't be a path the store already uses.");
  return path;
}

function readRazorpay() {
  const keyId = (process.env.RAZORPAY_KEY_ID || "").trim();
  const keySecret = (process.env.RAZORPAY_KEY_SECRET || "").trim();
  const webhookSecret = (process.env.RAZORPAY_WEBHOOK_SECRET || "").trim();
  return { keyId, keySecret, webhookSecret, enabled: Boolean(keyId && keySecret) };
}

module.exports = readConfig();
