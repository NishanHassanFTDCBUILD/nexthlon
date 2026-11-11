// Checks every environment variable the app reads, once, at start-up.
//
//   errors    a setting is missing or wrong, so the server must not start. They are all collected,
//             so one run shows every problem instead of one at a time.
//   warnings  the server can run, but something is probably not what you want in production
//             (the default admin path, no email, test payment keys...).
//
// It is a pure function of the environment, so tests can feed it any combination.

const DURATION = /^(\d{1,4})([smhd])$/;
const UNIT_MS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
const durationToMs = value => {
  const [, count, unit] = value.match(DURATION);
  return Number(count) * UNIT_MS[unit];
};

// name → [default, longest allowed]. A login lasts this long (see models/RefreshToken.js).
const DURATIONS = {
  ACCESS_TOKEN_EXPIRES_IN: ["15m", "1h"],
  REFRESH_TOKEN_EXPIRES_IN: ["7d", "30d"],
  ADMIN_REFRESH_TOKEN_EXPIRES_IN: ["1d", "7d"]
};

// Paths the store already uses can't be the admin path.
const RESERVED_PATHS = ["/api", "/account", "/products", "/cart", "/checkout", "/orders", "/login", "/signup", "/wallet",
  "/profile", "/wishlist", "/lists", "/css", "/js", "/img", "/uploads", "/about", "/contact", "/privacy", "/terms",
  "/healthz", "/readyz", "/fonts", "/robots.txt", "/sitemap.xml"];

const LOG_LEVELS = ["error", "warn", "info", "debug"];

const text = (env, name) => String(env[name] ?? "").trim();

function checkEnv(env = process.env) {
  const errors = [];
  const warnings = [];
  const fail = (name, message) => errors.push(`${name}: ${message}`);
  const warn = (name, message) => warnings.push(`${name}: ${message}`);

  const nodeEnv = text(env, "NODE_ENV") || "development";
  if (!["development", "production", "test"].includes(nodeEnv)) {
    // A typo such as "prod" would silently run in development mode: cookies not Secure, caching off.
    fail("NODE_ENV", `"${nodeEnv}" is not valid. Use development, production or test.`);
  }
  const production = nodeEnv === "production";

  // ---------- Required ----------
  const mongo = text(env, "MONGODB_URI");
  if (!mongo) fail("MONGODB_URI", "is missing. Copy .env.example to .env and set it (for Atlas: the mongodb+srv:// connection string).");
  else if (!/^mongodb(\+srv)?:\/\//.test(mongo)) fail("MONGODB_URI", "must start with mongodb:// or mongodb+srv://.");

  const secret = String(env.JWT_SECRET ?? "");
  if (Buffer.byteLength(secret) < 32) {
    fail("JWT_SECRET", "must be at least 32 characters. Make one with: node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\"");
  } else if (new Set(secret).size < 8) {
    // "aaaaaaaa..." or a repeated phrase passes the length check but is easy to guess.
    (production ? fail : warn)("JWT_SECRET", "looks guessable (very few different characters). Make a random one.");
  }

  // ---------- Server ----------
  const port = text(env, "PORT");
  if (port && !(/^\d+$/.test(port) && Number(port) >= 1 && Number(port) <= 65535)) fail("PORT", `"${port}" is not a port number (1 to 65535).`);

  // How many proxies sit in front of the app (a host's load balancer = 1, Cloudflare + a host = 2).
  // Too low: every visitor looks like the proxy, so one rate limit covers everyone. Too high: a visitor
  // can fake their address with an X-Forwarded-For header and slip past rate limits.
  const proxy = text(env, "TRUST_PROXY");
  if (proxy && !/^[0-5]$/.test(proxy)) fail("TRUST_PROXY", `"${proxy}" must be the number of proxies in front of the app, from 0 to 5 (a hosting platform: 1; Cloudflare in front of a host: 2).`);

  const site = text(env, "SITE_URL");
  if (site) {
    let url = null;
    try { url = new URL(site); } catch { /* reported below */ }
    if (!url || !/^https?:$/.test(url.protocol) || url.pathname !== "/" || url.search || url.hash) {
      fail("SITE_URL", `"${site}" must be the address of the store with no path, for example https://www.nexthlon.in`);
    } else if (production && url.protocol !== "https:") {
      fail("SITE_URL", "must start with https:// in production (login cookies are Secure and only travel over HTTPS).");
    }
  } else if (production) {
    warn("SITE_URL", "is not set. Emails, the sitemap and share previews need the store's public address, for example https://www.nexthlon.in");
  }

  // ---------- Logins ----------
  for (const [name, [fallback, limit]] of Object.entries(DURATIONS)) {
    const value = text(env, name) || fallback;
    if (!DURATION.test(value) || durationToMs(value) > durationToMs(limit)) {
      fail(name, `"${value}" must look like 15m, 12h or 7d, and be ${limit} or less. The default is ${fallback}.`);
    }
  }
  if (text(env, "JWT_EXPIRES_IN")) warn("JWT_EXPIRES_IN", "is no longer read. Use ACCESS_TOKEN_EXPIRES_IN.");

  // ---------- Admin console ----------
  const rawAdmin = text(env, "ADMIN_PATH") || "/admin";
  const adminPath = (rawAdmin.startsWith("/") ? rawAdmin : `/${rawAdmin}`).replace(/\/+$/, "").toLowerCase();
  if (!/^\/[a-z0-9_-]{3,64}$/.test(adminPath)) {
    fail("ADMIN_PATH", "must be one path segment of 3 to 64 letters, numbers, - or _ (for example /nx-console-7f3k).");
  } else if (RESERVED_PATHS.includes(adminPath)) {
    fail("ADMIN_PATH", "can't be a path the store already uses.");
  } else if (production && adminPath === "/admin") {
    warn("ADMIN_PATH", "is the guessable default /admin. Pick a private path, for example /nx-console-7f3k.");
  }

  // ---------- Online payments (Razorpay) ----------
  const keyId = text(env, "RAZORPAY_KEY_ID");
  const keySecret = text(env, "RAZORPAY_KEY_SECRET");
  if (Boolean(keyId) !== Boolean(keySecret)) {
    fail(keyId ? "RAZORPAY_KEY_SECRET" : "RAZORPAY_KEY_ID", "is missing. Set both Razorpay keys, or neither (online payments are then switched off).");
  } else if (keyId) {
    if (production && keyId.startsWith("rzp_test_")) warn("RAZORPAY_KEY_ID", "is a TEST mode key but this is production, so no real money moves. Use the live key to take payments.");
    if (!production && keyId.startsWith("rzp_live_")) warn("RAZORPAY_KEY_ID", "is a LIVE key outside production. Use a test key while developing.");
    if (!text(env, "RAZORPAY_WEBHOOK_SECRET")) warn("RAZORPAY_WEBHOOK_SECRET", "is not set, so payment confirmations from Razorpay's webhook can't be checked.");
  } else if (production) {
    warn("RAZORPAY_KEY_ID", "is not set, so online payments are switched off (cash on delivery and the wallet still work).");
  }

  // ---------- Email ----------
  const smtpPort = text(env, "SMTP_PORT");
  if (smtpPort && !(/^\d+$/.test(smtpPort) && Number(smtpPort) >= 1 && Number(smtpPort) <= 65535)) fail("SMTP_PORT", `"${smtpPort}" is not a port number.`);
  if (text(env, "SMTP_HOST")) {
    if (!text(env, "SMTP_USER") || !String(env.SMTP_PASS ?? "")) warn("SMTP_USER", "or SMTP_PASS is empty. Most email services need both.");
  } else if (production) {
    warn("SMTP_HOST", "is not set, so no email can be sent (order emails, password resets).");
  }

  // ---------- Monitoring and logs ----------
  const dsn = text(env, "SENTRY_DSN");
  if (dsn) {
    let ok = false;
    try { const url = new URL(dsn); ok = /^https?:$/.test(url.protocol) && Boolean(url.username) && url.pathname.length > 1; } catch { /* not a URL */ }
    if (!ok) fail("SENTRY_DSN", "is not a Sentry DSN. It looks like https://<key>@<host>/<project-id>");
  } else if (production) {
    warn("SENTRY_DSN", "is not set, so server errors are only in the logs and nobody is alerted.");
  }
  const level = text(env, "LOG_LEVEL").toLowerCase();
  if (level && !LOG_LEVELS.includes(level)) warn("LOG_LEVEL", `"${level}" is not one of ${LOG_LEVELS.join(", ")}. Using info.`);
  const format = text(env, "LOG_FORMAT").toLowerCase();
  if (format && !["json", "text"].includes(format)) warn("LOG_FORMAT", `"${format}" is not json or text. Using the default.`);

  return { errors, warnings };
}

module.exports = { checkEnv, DURATIONS, RESERVED_PATHS, durationToMs, DURATION };
