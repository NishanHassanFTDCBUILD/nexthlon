require('dotenv').config();

const {checkEnv, DURATIONS, durationToMs} = require('./schema');

// Every variable is checked in config/schema.js before anything is read, so a bad setting stops the
// server at start-up with ALL the problems listed at once.
function readConfig() {
  const {errors, warnings} = checkEnv(process.env);
  if (errors.length) {
    throw new Error(
      `The settings in .env are not valid:\n  - ${errors.join('\n  - ')}`,
    );
  }

  const isProduction = process.env.NODE_ENV === 'production';
  const text = (name) => String(process.env[name] ?? '').trim();
  const duration = (name) => text(name) || DURATIONS[name][0];

  // The access token is deliberately short-lived: it cannot be withdrawn once issued, so it must
  // run out quickly. The refresh token is the long-lived one, and that one CAN be revoked
  // (see models/RefreshToken.js), which is why it may live for days.
  const accessExpiresIn = duration('ACCESS_TOKEN_EXPIRES_IN');
  const refreshExpiresIn = duration('REFRESH_TOKEN_EXPIRES_IN');
  // Admin sessions are shorter than customer ones, because an admin can do more harm.
  const adminRefreshExpiresIn = duration('ADMIN_REFRESH_TOKEN_EXPIRES_IN');

  return {
    isProduction,
    port: Number(process.env.PORT) || 3000,
    mongoUri: text('MONGODB_URI'),
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
    cookieSecure: isProduction || process.env.COOKIE_SECURE === 'true',
    // How many proxies sit in front of the app (see config/schema.js). A hosting platform's load
    // balancer is one. Without a proxy (development) it is 0, so nobody can fake their address.
    trustProxy: text('TRUST_PROXY')
      ? Number(text('TRUST_PROXY'))
      : isProduction
        ? 1
        : 0,
    // Continue with Google (optional): both values from the Google Cloud console (a web OAuth client).
    google: {
      clientId: text('GOOGLE_CLIENT_ID'),
      clientSecret: text('GOOGLE_CLIENT_SECRET'),
    },
    facebook: {
      appId: text('FACEBOOK_APP_ID'),
      appSecret: text('FACEBOOK_APP_SECRET'),
    },
    // The store's public address, with no trailing slash (emails, sitemap, share previews).
    siteUrl: text('SITE_URL').replace(/\/+$/, ''),
    // Where uploaded photos are kept: "local" (public/uploads) or Cloudinary. The secrets never leave
    // the server, and Cloudinary serves the public URLs directly.
    storage: readStorage(),
    // Connections to MongoDB per copy of the app. Atlas's free tier allows 500 in all, so several copies
    // with the driver's default of 100 each could use them up.
    mongoMaxPool: Number(text('MONGODB_MAX_POOL')) || 20,
    // How many copies of the app this server runs (server.js): "auto" is one per CPU core.
    webConcurrency:
      text('WEB_CONCURRENCY') === 'auto'
        ? require('os').availableParallelism()
        : Number(text('WEB_CONCURRENCY')) || 1,
    // How long a CDN (Cloudflare) may keep a signed-out page (middleware/publicCache.js). Browsers never
    // keep it. Off in development, a minute in production, unless PUBLIC_CACHE_SECONDS says otherwise.
    publicCacheSeconds:
      text('PUBLIC_CACHE_SECONDS') !== ''
        ? Number(text('PUBLIC_CACHE_SECONDS'))
        : isProduction
          ? 60
          : 0,
    // Optional Redis (providers/redis.js): rate limits and cache clearing shared by every server copy.
    redisUrl: text('REDIS_URL'),
    // Background jobs (emails, reminders) run inside this server unless JOBS_ENABLED=false (then run
    // `npm run worker` elsewhere). Several at a time, JOBS_CONCURRENCY (default 2).
    jobs: {
      enabled: text('JOBS_ENABLED').toLowerCase() !== 'false',
      concurrency: Number(text('JOBS_CONCURRENCY')) || 2,
    },
    // Online payments (Razorpay). Optional: without the keys the store still runs, and the
    // online payment option shows as unavailable. The secrets never leave the server.
    razorpay: readRazorpay(),
    // The admin console lives under a private path (ADMIN_PATH, e.g. /nx-console-7f3k).
    adminPath: readAdminPath(),
    // Email (order emails, cart reminders, campaigns). Optional: without SMTP the emails are
    // written to the console in development. The values are never logged.
    mail: readMail(),
    // Marketplace feed and stock sync (E8). Set a long random MARKETPLACE_TOKEN to allow stock updates.
    marketplace: {token: String(process.env.MARKETPLACE_TOKEN ?? '').trim()},
    // Push notifications (E5): VAPID keys from npm run push:keys. Off without them.
    push: (() => {
      const publicKey = text('VAPID_PUBLIC_KEY');
      const privateKey = text('VAPID_PRIVATE_KEY');
      return {
        publicKey,
        privateKey,
        subject: text('VAPID_SUBJECT') || 'mailto:support@example.com',
        enabled: Boolean(publicKey && privateKey),
      };
    })(),
    // Shipping (B5): "manual" (the admin types the courier and tracking number) or "shiprocket"
    // (one-click shipments, live PIN code checks and tracking updates). services/shipping/.
    shipping: readShipping(),
    // Visitor analytics (utils/analytics.js). Off unless set, and only loads after the visitor agrees.
    analytics: require('../utils/analytics').readAnalytics(),
    metaPixel: require('../utils/analytics').readMetaPixel(),
    // Error alerts. Optional: without a DSN nothing is sent anywhere.
    sentry: {
      dsn: text('SENTRY_DSN'),
      environment:
        text('SENTRY_ENVIRONMENT') ||
        (isProduction ? 'production' : 'development'),
      enabled: Boolean(text('SENTRY_DSN')),
    },
    // Which build is running, shown in error alerts. Set it to the Git commit in your deploy.
    release:
      text('APP_RELEASE') || `nexthlon@${require('../package.json').version}`,
    // Things that work but are probably not what you want in production (config/schema.js).
    warnings,
  };
}

function readStorage() {
  const text = (name) => String(process.env[name] ?? '').trim();
  const wanted = text('STORAGE_DRIVER').toLowerCase();
  const driver = wanted === 'cloudinary' ? 'cloudinary' : 'local';
  const cloudName = text('CLOUDINARY_CLOUD_NAME');
  // Cloudinary serves from a fixed address built from the cloud name.
  const publicUrl =
    driver === 'cloudinary' && cloudName
      ? `https://res.cloudinary.com/${cloudName}/image/upload`
      : '';
  return {
    driver,
    // The address photos are served from (no trailing slash), and its origin for the Content Security Policy.
    publicUrl: driver === 'local' ? '' : publicUrl,
    origin: driver !== 'local' && publicUrl ? new URL(publicUrl).origin : '',
    cloudName,
    apiKey: text('CLOUDINARY_API_KEY'),
    apiSecret: String(process.env.CLOUDINARY_API_SECRET ?? ''),
  };
}

function readMail() {
  const host = (process.env.SMTP_HOST || '').trim();
  const port = Number(process.env.SMTP_PORT) || 587;
  const user = (process.env.SMTP_USER || '').trim();
  const pass = process.env.SMTP_PASS || '';
  const brevoApiKey = (process.env.BREVO_API_KEY || '').trim();
  // Which service sends: "smtp" (any provider's SMTP login) or "brevo" (its HTTPS API). Picked by MAIL_DRIVER,
  // or brevo when only its key is set.
  const named = (process.env.MAIL_DRIVER || '').trim().toLowerCase();
  const driver = named || (brevoApiKey && !host ? 'brevo' : 'smtp');
  const from =
    (process.env.MAIL_FROM || '').trim() ||
    (user ? `Nexthlon <${user}>` : 'Nexthlon <no-reply@localhost>');
  return {
    driver,
    host,
    port,
    user,
    pass,
    brevoApiKey,
    from,
    secure: port === 465,
    enabled: driver === 'brevo' ? Boolean(brevoApiKey) : Boolean(host),
  };
}

function readAdminPath() {
  const raw = (process.env.ADMIN_PATH || '/admin').trim().replace(/\/+$/, '');
  return (raw.startsWith('/') ? raw : `/${raw}`).toLowerCase();
}

// Shipping settings. Shiprocket is only used when its login and pickup location are all set.
function readShipping() {
  const text = (name) => String(process.env[name] ?? '').trim();
  const shiprocket = {
    email: text('SHIPROCKET_EMAIL'),
    password: text('SHIPROCKET_PASSWORD'),
    pickupLocation: text('SHIPROCKET_PICKUP_LOCATION'),
    webhookToken: text('SHIPROCKET_WEBHOOK_TOKEN'),
    baseUrl: (
      text('SHIPROCKET_API_URL') || 'https://apiv2.shiprocket.in/v1/external'
    ).replace(/\/+$/, ''),
  };
  shiprocket.enabled = Boolean(
    shiprocket.email && shiprocket.password && shiprocket.pickupLocation,
  );
  const wanted = text('SHIPPING_PROVIDER').toLowerCase();
  return {
    provider:
      wanted === 'shiprocket' && shiprocket.enabled ? 'shiprocket' : 'manual',
    // The warehouse PIN code: where parcels leave from (used for PIN code checks).
    pickupPincode: text('SHIPPING_PICKUP_PINCODE'),
    // Parcel weight in kg when a product has none (couriers price by weight).
    defaultWeightKg: Number(text('SHIPPING_DEFAULT_WEIGHT_KG')) || 0.5,
    shiprocket,
  };
}

function readRazorpay() {
  const keyId = (process.env.RAZORPAY_KEY_ID || '').trim();
  const keySecret = (process.env.RAZORPAY_KEY_SECRET || '').trim();
  const webhookSecret = (process.env.RAZORPAY_WEBHOOK_SECRET || '').trim();
  return {
    keyId,
    keySecret,
    webhookSecret,
    enabled: Boolean(keyId && keySecret),
  };
}

module.exports = readConfig();
