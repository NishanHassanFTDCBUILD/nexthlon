require("dotenv").config();

const { checkEnv, DURATIONS, durationToMs } = require("./schema");

// Every variable is checked in config/schema.js before anything is read, so a bad setting stops the
// server at start-up with ALL the problems listed at once.
function readConfig() {
  const { errors, warnings } = checkEnv(process.env);
  if (errors.length) {
    throw new Error(`The settings in .env are not valid:\n  - ${errors.join("\n  - ")}`);
  }

  const isProduction = process.env.NODE_ENV === "production";
  const text = name => String(process.env[name] ?? "").trim();
  const duration = name => text(name) || DURATIONS[name][0];

  // The access token is deliberately short-lived: it cannot be withdrawn once issued, so it must
  // run out quickly. The refresh token is the long-lived one, and that one CAN be revoked
  // (see models/RefreshToken.js), which is why it may live for days.
  const accessExpiresIn = duration("ACCESS_TOKEN_EXPIRES_IN");
  const refreshExpiresIn = duration("REFRESH_TOKEN_EXPIRES_IN");
  // Admin sessions are shorter than customer ones, because an admin can do more harm.
  const adminRefreshExpiresIn = duration("ADMIN_REFRESH_TOKEN_EXPIRES_IN");

  return {
    isProduction,
    port: Number(process.env.PORT) || 3000,
    mongoUri: text("MONGODB_URI"),
    jwtSecret: process.env.JWT_SECRET,
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
    // How many proxies sit in front of the app (see config/schema.js). A hosting platform's load
    // balancer is one. Without a proxy (development) it is 0, so nobody can fake their address.
    trustProxy: text("TRUST_PROXY") ? Number(text("TRUST_PROXY")) : isProduction ? 1 : 0,
    // The store's public address, with no trailing slash (emails, sitemap, share previews).
    siteUrl: text("SITE_URL").replace(/\/+$/, ""),
    // Where uploaded photos are kept: "local" (public/uploads) or "s3" (R2, S3 and other S3-compatible
    // buckets, served from publicUrl). The secrets never leave the server.
    storage: readStorage(),
    // Connections to MongoDB per copy of the app. Atlas's free tier allows 500 in all, so several copies
    // with the driver's default of 100 each could use them up.
    mongoMaxPool: Number(text("MONGODB_MAX_POOL")) || 20,
    // Background jobs (emails, reminders) run inside this server unless JOBS_ENABLED=false (then run
    // `npm run worker` elsewhere). Several at a time, JOBS_CONCURRENCY (default 2).
    jobs: {
      enabled: text("JOBS_ENABLED").toLowerCase() !== "false",
      concurrency: Number(text("JOBS_CONCURRENCY")) || 2
    },
    // true: abandoned carts get their reminder automatically (once a day each); false: only the admin's button.
    cartRecoveryAuto: text("CART_RECOVERY_AUTO").toLowerCase() === "true",
    // true: admins must turn on two-step login before they can use the console (middleware/twoFactorGuard.js).
    adminRequire2fa: text("ADMIN_REQUIRE_2FA").toLowerCase() === "true",
    // Online payments (Razorpay). Optional: without the keys the store still runs, and the
    // online payment option shows as unavailable. The secrets never leave the server.
    razorpay: readRazorpay(),
    // The admin console lives under a private path (ADMIN_PATH, e.g. /nx-console-7f3k).
    adminPath: readAdminPath(),
    // Email (order emails, cart reminders, campaigns). Optional: without SMTP the emails are
    // written to the console in development. The values are never logged.
    mail: readMail(),
    // Error alerts. Optional: without a DSN nothing is sent anywhere.
    sentry: {
      dsn: text("SENTRY_DSN"),
      environment: text("SENTRY_ENVIRONMENT") || (isProduction ? "production" : "development"),
      enabled: Boolean(text("SENTRY_DSN"))
    },
    // Which build is running, shown in error alerts. Set it to the Git commit in your deploy.
    release: text("APP_RELEASE") || `nexthlon@${require("../package.json").version}`,
    // Things that work but are probably not what you want in production (config/schema.js).
    warnings
  };
}

function readStorage() {
  const text = name => String(process.env[name] ?? "").trim();
  const wanted = text("STORAGE_DRIVER").toLowerCase();
  const driver = ["s3", "cloudinary"].includes(wanted) ? wanted : "local";
  const cloudName = text("CLOUDINARY_CLOUD_NAME");
  // Cloudinary serves from a fixed address built from the cloud name; a bucket from STORAGE_PUBLIC_URL.
  const publicUrl = driver === "cloudinary" ? (cloudName ? `https://res.cloudinary.com/${cloudName}/image/upload` : "") : text("STORAGE_PUBLIC_URL").replace(/\/+$/, "");
  return {
    driver,
    // The address photos are served from (no trailing slash), and its origin for the Content Security Policy.
    publicUrl: driver === "local" ? "" : publicUrl,
    origin: driver !== "local" && publicUrl ? new URL(publicUrl).origin : "",
    cloudName,
    apiKey: text("CLOUDINARY_API_KEY"),
    apiSecret: String(process.env.CLOUDINARY_API_SECRET ?? ""),
    endpoint: text("S3_ENDPOINT").replace(/\/+$/, ""),
    region: text("S3_REGION") || "auto",
    bucket: text("S3_BUCKET"),
    accessKeyId: text("S3_ACCESS_KEY_ID"),
    secretAccessKey: String(process.env.S3_SECRET_ACCESS_KEY ?? "")
  };
}

function readMail() {
  const host = (process.env.SMTP_HOST || "").trim();
  const port = Number(process.env.SMTP_PORT) || 587;
  const user = (process.env.SMTP_USER || "").trim();
  const pass = process.env.SMTP_PASS || "";
  const brevoApiKey = (process.env.BREVO_API_KEY || "").trim();
  // Which service sends: "smtp" (any provider's SMTP login) or "brevo" (its HTTPS API). Picked by MAIL_DRIVER,
  // or brevo when only its key is set.
  const named = (process.env.MAIL_DRIVER || "").trim().toLowerCase();
  const driver = named || (brevoApiKey && !host ? "brevo" : "smtp");
  const from = (process.env.MAIL_FROM || "").trim() || (user ? `Nexthlon <${user}>` : "Nexthlon <no-reply@localhost>");
  return { driver, host, port, user, pass, brevoApiKey, from, secure: port === 465, enabled: driver === "brevo" ? Boolean(brevoApiKey) : Boolean(host) };
}

function readAdminPath() {
  const raw = (process.env.ADMIN_PATH || "/admin").trim().replace(/\/+$/, "");
  return (raw.startsWith("/") ? raw : `/${raw}`).toLowerCase();
}

function readRazorpay() {
  const keyId = (process.env.RAZORPAY_KEY_ID || "").trim();
  const keySecret = (process.env.RAZORPAY_KEY_SECRET || "").trim();
  const webhookSecret = (process.env.RAZORPAY_WEBHOOK_SECRET || "").trim();
  return { keyId, keySecret, webhookSecret, enabled: Boolean(keyId && keySecret) };
}

module.exports = readConfig();
