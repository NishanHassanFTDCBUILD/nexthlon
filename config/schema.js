// Checks every environment variable the app reads, once, at start-up.
//
//   errors    a setting is missing or wrong, so the server must not start. They are all collected,
//             so one run shows every problem instead of one at a time.
//   warnings  the server can run, but something is probably not what you want in production
//             (the default admin path, no email, test payment keys...).
//
// It is a pure function of the environment, so tests can feed it any combination.

const DURATION = /^(\d{1,4})([smhd])$/;
const UNIT_MS = {s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000};
const durationToMs = (value) => {
  const [, count, unit] = value.match(DURATION);
  return Number(count) * UNIT_MS[unit];
};

// name → [default, longest allowed]. A login lasts this long (see models/RefreshToken.js).
const DURATIONS = {
  ACCESS_TOKEN_EXPIRES_IN: ['15m', '1h'],
  REFRESH_TOKEN_EXPIRES_IN: ['7d', '30d'],
  ADMIN_REFRESH_TOKEN_EXPIRES_IN: ['1d', '7d'],
};

// Paths the store already uses can't be the admin path.
const RESERVED_PATHS = [
  '/api',
  '/account',
  '/products',
  '/cart',
  '/checkout',
  '/orders',
  '/login',
  '/signup',
  '/wallet',
  '/profile',
  '/wishlist',
  '/lists',
  '/css',
  '/js',
  '/img',
  '/uploads',
  '/about',
  '/contact',
  '/privacy',
  '/terms',
  '/healthz',
  '/readyz',
  '/fonts',
  '/robots.txt',
  '/sitemap.xml',
];

const LOG_LEVELS = ['error', 'warn', 'info', 'debug'];

const text = (env, name) => String(env[name] ?? '').trim();

function checkEnv(env = process.env) {
  const errors = [];
  const warnings = [];
  const fail = (name, message) => errors.push(`${name}: ${message}`);
  const warn = (name, message) => warnings.push(`${name}: ${message}`);

  const nodeEnv = text(env, 'NODE_ENV') || 'development';
  if (!['development', 'production', 'test'].includes(nodeEnv)) {
    // A typo such as "prod" would silently run in development mode: cookies not Secure, caching off.
    fail(
      'NODE_ENV',
      `"${nodeEnv}" is not valid. Use development, production or test.`,
    );
  }
  const production = nodeEnv === 'production';

  // ---------- Required ----------
  const mongo = text(env, 'MONGODB_URI');
  if (!mongo)
    fail(
      'MONGODB_URI',
      'is missing. Copy .env.example to .env and set it (for Atlas: the mongodb+srv:// connection string).',
    );
  else if (!/^mongodb(\+srv)?:\/\//.test(mongo))
    fail('MONGODB_URI', 'must start with mongodb:// or mongodb+srv://.');
  else {
    // Atlas shows the string with a placeholder where the password goes, and without a database name.
    if (/<[^>]*(password|db_password)[^>]*>/i.test(mongo))
      fail(
        'MONGODB_URI',
        "still has the <password> placeholder from Atlas. Replace it, including the < >, with the database user's password (special characters such as @ : / ? # must be URL-encoded).",
      );
    // Everything after the last / and before ?: the database name. Without it MongoDB uses "test".
    const database = (
      mongo.replace(/^mongodb(\+srv)?:\/\/[^/]*/, '').split('?')[0] || ''
    ).replace(/^\//, '');
    if (!database)
      warn(
        'MONGODB_URI',
        'has no database name, so MongoDB would use one called "test". Put it after the host, for example ...mongodb.net/nexthlon?retryWrites=true',
      );
    else if (production && /(^|[-_])test$/i.test(database))
      warn(
        'MONGODB_URI',
        `uses the database "${database}", which looks like a test database.`,
      );
  }
  const pool = text(env, 'MONGODB_MAX_POOL');
  if (pool && !(/^\d+$/.test(pool) && Number(pool) >= 1 && Number(pool) <= 100))
    fail(
      'MONGODB_MAX_POOL',
      `"${pool}" must be a number from 1 to 100 (connections per server copy; the default is 20).`,
    );

  // Scaling out (docs/SCALING.md).
  const copies = text(env, 'WEB_CONCURRENCY');
  if (
    copies &&
    !(
      copies === 'auto' ||
      (/^\d+$/.test(copies) && Number(copies) >= 1 && Number(copies) <= 32)
    )
  ) {
    fail(
      'WEB_CONCURRENCY',
      `"${copies}" must be "auto" (one copy per CPU core) or a number from 1 to 32.`,
    );
  }
  const cacheSeconds = text(env, 'PUBLIC_CACHE_SECONDS');
  if (
    cacheSeconds &&
    !(/^\d+$/.test(cacheSeconds) && Number(cacheSeconds) <= 600)
  ) {
    fail(
      'PUBLIC_CACHE_SECONDS',
      `"${cacheSeconds}" must be a number of seconds from 0 (off) to 600.`,
    );
  }
  const redisUrl = text(env, 'REDIS_URL');
  if (redisUrl && !/^rediss?:\/\/\S+$/.test(redisUrl))
    fail(
      'REDIS_URL',
      'must start with redis:// or rediss:// (the address your Redis host gives you).',
    );
  else if (
    redisUrl &&
    production &&
    redisUrl.startsWith('redis://') &&
    !/localhost|127\.0\.0\.1/.test(redisUrl)
  ) {
    warn(
      'REDIS_URL',
      'uses redis:// (not encrypted). Use the rediss:// address if your Redis host offers one.',
    );
  }
  // Every server copy opens up to MONGODB_MAX_POOL connections; MongoDB Atlas's free tier allows 500 in all.
  const perServer =
    (copies === 'auto'
      ? require('os').availableParallelism()
      : Number(copies) || 1) * (Number(pool) || 20);
  if (perServer > 200)
    warn(
      'MONGODB_MAX_POOL',
      `${perServer} database connections per server (WEB_CONCURRENCY × MONGODB_MAX_POOL). Atlas's free tier allows 500 for all servers together: lower MONGODB_MAX_POOL, or move to a paid tier.`,
    );

  const secret = String(env.JWT_SECRET ?? '');
  if (Buffer.byteLength(secret) < 32) {
    fail(
      'JWT_SECRET',
      "must be at least 32 characters. Make one with: node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\"",
    );
  } else if (new Set(secret).size < 8) {
    // "aaaaaaaa..." or a repeated phrase passes the length check but is easy to guess.
    (production ? fail : warn)(
      'JWT_SECRET',
      'looks guessable (very few different characters). Make a random one.',
    );
  }

  // ---------- Server ----------
  const port = text(env, 'PORT');
  if (
    port &&
    !(/^\d+$/.test(port) && Number(port) >= 1 && Number(port) <= 65535)
  )
    fail('PORT', `"${port}" is not a port number (1 to 65535).`);

  // How many proxies sit in front of the app (a host's load balancer = 1, Cloudflare + a host = 2).
  // Too low: every visitor looks like the proxy, so one rate limit covers everyone. Too high: a visitor
  // can fake their address with an X-Forwarded-For header and slip past rate limits.
  const proxy = text(env, 'TRUST_PROXY');
  if (proxy && !/^[0-5]$/.test(proxy))
    fail(
      'TRUST_PROXY',
      `"${proxy}" must be the number of proxies in front of the app, from 0 to 5 (a hosting platform: 1; Cloudflare in front of a host: 2).`,
    );

  const site = text(env, 'SITE_URL');
  if (site) {
    let url = null;
    try {
      url = new URL(site);
    } catch {
      /* reported below */
    }
    if (
      !url ||
      !/^https?:$/.test(url.protocol) ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    ) {
      fail(
        'SITE_URL',
        `"${site}" must be the address of the store with no path, for example https://www.nexthlon.in`,
      );
    } else if (production && url.protocol !== 'https:') {
      fail(
        'SITE_URL',
        'must start with https:// in production (login cookies are Secure and only travel over HTTPS).',
      );
    }
  } else if (production) {
    // Password-reset and confirmation emails contain a link to the store. The address cannot be taken from the
    // request: a forged Host header would point the link at someone else's website.
    fail(
      'SITE_URL',
      'is not set. Emails (password reset, confirmation) link to the store, so production needs its public address, for example https://www.nexthlon.in',
    );
  }

  // ---------- Logins ----------
  for (const [name, [fallback, limit]] of Object.entries(DURATIONS)) {
    const value = text(env, name) || fallback;
    if (!DURATION.test(value) || durationToMs(value) > durationToMs(limit)) {
      fail(
        name,
        `"${value}" must look like 15m, 12h or 7d, and be ${limit} or less. The default is ${fallback}.`,
      );
    }
  }
  if (text(env, 'JWT_EXPIRES_IN'))
    warn('JWT_EXPIRES_IN', 'is no longer read. Use ACCESS_TOKEN_EXPIRES_IN.');

  // ---------- Admin console ----------
  const rawAdmin = text(env, 'ADMIN_PATH') || '/admin';
  const adminPath = (rawAdmin.startsWith('/') ? rawAdmin : `/${rawAdmin}`)
    .replace(/\/+$/, '')
    .toLowerCase();
  if (!/^\/[a-z0-9_-]{3,64}$/.test(adminPath)) {
    fail(
      'ADMIN_PATH',
      'must be one path segment of 3 to 64 letters, numbers, - or _ (for example /nx-console-7f3k).',
    );
  } else if (RESERVED_PATHS.includes(adminPath)) {
    fail('ADMIN_PATH', "can't be a path the store already uses.");
  } else if (production && adminPath === '/admin') {
    warn(
      'ADMIN_PATH',
      'is the guessable default /admin. Pick a private path, for example /nx-console-7f3k.',
    );
  }

  // ---------- Online payments (Razorpay) ----------
  const keyId = text(env, 'RAZORPAY_KEY_ID');
  const keySecret = text(env, 'RAZORPAY_KEY_SECRET');
  if (Boolean(keyId) !== Boolean(keySecret)) {
    fail(
      keyId ? 'RAZORPAY_KEY_SECRET' : 'RAZORPAY_KEY_ID',
      'is missing. Set both Razorpay keys, or neither (online payments are then switched off).',
    );
  } else if (keyId) {
    if (production && keyId.startsWith('rzp_test_'))
      warn(
        'RAZORPAY_KEY_ID',
        'is a TEST mode key but this is production, so no real money moves. Use the live key to take payments.',
      );
    if (!production && keyId.startsWith('rzp_live_'))
      warn(
        'RAZORPAY_KEY_ID',
        'is a LIVE key outside production. Use a test key while developing.',
      );
    if (!text(env, 'RAZORPAY_WEBHOOK_SECRET'))
      warn(
        'RAZORPAY_WEBHOOK_SECRET',
        "is not set, so payment confirmations from Razorpay's webhook can't be checked.",
      );
  } else if (production) {
    warn(
      'RAZORPAY_KEY_ID',
      'is not set, so online payments are switched off (cash on delivery and the wallet still work).',
    );
  }

  // ---------- Photo storage ----------
  // local: files in public/uploads (development; a host's disk is wiped on every deploy unless it has a volume).
  const driver = text(env, 'STORAGE_DRIVER').toLowerCase() || 'local';
  if (!['local', 'cloudinary'].includes(driver)) {
    fail('STORAGE_DRIVER', `"${driver}" must be local or cloudinary.`);
  } else if (driver === 'cloudinary') {
    for (const name of [
      'CLOUDINARY_CLOUD_NAME',
      'CLOUDINARY_API_KEY',
      'CLOUDINARY_API_SECRET',
    ]) {
      if (!text(env, name))
        fail(
          name,
          'is missing. It is needed when STORAGE_DRIVER=cloudinary (Cloudinary dashboard > API keys).',
        );
    }
    const cloud = text(env, 'CLOUDINARY_CLOUD_NAME');
    if (cloud && !/^[a-z0-9_-]+$/i.test(cloud))
      fail(
        'CLOUDINARY_CLOUD_NAME',
        `"${cloud}" should be just the cloud name from the dashboard, for example dxyz12abc.`,
      );
  } else if (production) {
    warn(
      'STORAGE_DRIVER',
      "is local: uploaded photos are written to the server's disk, which many hosts wipe on every deploy. Use cloudinary in production.",
    );
  }

  // ---------- Background jobs ----------
  for (const name of ['JOBS_ENABLED']) {
    const value = text(env, name).toLowerCase();
    if (value && !['true', 'false'].includes(value))
      fail(name, `"${value}" must be true or false.`);
  }
  const concurrency = text(env, 'JOBS_CONCURRENCY');
  if (
    concurrency &&
    !(
      /^\d+$/.test(concurrency) &&
      Number(concurrency) >= 1 &&
      Number(concurrency) <= 10
    )
  )
    fail('JOBS_CONCURRENCY', `"${concurrency}" must be a number from 1 to 10.`);

  // ---------- Email ----------
  const mailDriver = text(env, 'MAIL_DRIVER').toLowerCase();
  if (mailDriver && !['smtp', 'brevo'].includes(mailDriver))
    fail('MAIL_DRIVER', `"${mailDriver}" must be smtp or brevo.`);
  const usingBrevo =
    mailDriver === 'brevo' ||
    (!mailDriver && text(env, 'BREVO_API_KEY') && !text(env, 'SMTP_HOST'));
  if (usingBrevo && !text(env, 'BREVO_API_KEY'))
    fail(
      'BREVO_API_KEY',
      'is missing. It is needed when MAIL_DRIVER=brevo (Brevo > SMTP & API > API keys).',
    );
  if (
    production &&
    !text(env, 'MAIL_FROM') &&
    (usingBrevo || text(env, 'SMTP_HOST'))
  ) {
    warn(
      'MAIL_FROM',
      'is not set, so emails come from a made-up address. Use an address on your own domain, for example Nexthlon <orders@nexthlon.in>, and verify the domain with your email provider (SPF and DKIM), or they land in spam.',
    );
  }
  const smtpPort = text(env, 'SMTP_PORT');
  if (
    smtpPort &&
    !(
      /^\d+$/.test(smtpPort) &&
      Number(smtpPort) >= 1 &&
      Number(smtpPort) <= 65535
    )
  )
    fail('SMTP_PORT', `"${smtpPort}" is not a port number.`);
  if (usingBrevo) {
    // nothing more to check: the key is the login
  } else if (text(env, 'SMTP_HOST')) {
    if (!text(env, 'SMTP_USER') || !String(env.SMTP_PASS ?? ''))
      warn(
        'SMTP_USER',
        'or SMTP_PASS is empty. Most email services need both.',
      );
  } else if (production) {
    warn(
      'SMTP_HOST',
      'is not set, so no email can be sent (order emails, password resets). Set SMTP_HOST and its login, or MAIL_DRIVER=brevo with BREVO_API_KEY.',
    );
  }

  // ---------- Store details (config/store.js) ----------
  // The legally required business details. Placeholders are fine while building, not in a live shop.
  const STORE_SETTINGS = {
    STORE_LEGAL_NAME: 'registered business name',
    STORE_ADDRESS: 'business address',
    STORE_SUPPORT_EMAIL: 'support email',
    STORE_SUPPORT_PHONE: 'support phone number',
    STORE_GRIEVANCE_OFFICER: "grievance officer's name",
  };
  if (production) {
    for (const [name, what] of Object.entries(STORE_SETTINGS)) {
      if (!text(env, name))
        warn(
          name,
          `is not set, so the site shows a placeholder for the ${what}. India's e-commerce rules and Razorpay need the real one.`,
        );
    }
  }
  const supportEmail = text(env, 'STORE_SUPPORT_EMAIL');
  if (supportEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(supportEmail))
    fail('STORE_SUPPORT_EMAIL', `"${supportEmail}" is not an email address.`);
  const gstin = text(env, 'STORE_GSTIN');
  if (gstin && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin))
    warn(
      'STORE_GSTIN',
      `"${gstin}" does not look like a GSTIN (15 characters, for example 29ABCDE1234F1Z5).`,
    );
  // The GST state decides CGST + SGST or IGST on every invoice, so it must be a real state, and match the GSTIN.
  const {STATE_CODES} = require('../utils/gst');
  const gstState = text(env, 'STORE_STATE') || 'Kerala';
  if (!STATE_CODES[gstState])
    fail(
      'STORE_STATE',
      `"${gstState}" is not an Indian state or union territory as the address form spells it (for example Kerala, Tamil Nadu, Delhi).`,
    );
  else if (
    gstin &&
    /^\d{2}/.test(gstin) &&
    gstin.slice(0, 2) !== STATE_CODES[gstState]
  )
    warn(
      'STORE_STATE',
      `The GSTIN starts with ${gstin.slice(0, 2)}, but ${gstState}'s code is ${STATE_CODES[gstState]}. Check STORE_STATE and STORE_GSTIN.`,
    );
  const scheme = text(env, 'STORE_GST_SCHEME');
  if (scheme && !['regular', 'composition'].includes(scheme))
    fail('STORE_GST_SCHEME', `"${scheme}" must be regular or composition.`);

  if (
    Boolean(text(env, 'VAPID_PUBLIC_KEY')) !==
    Boolean(text(env, 'VAPID_PRIVATE_KEY'))
  )
    fail(
      'VAPID_PRIVATE_KEY',
      'VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY go together (npm run push:keys makes a pair).',
    );
  const vapidSubject = text(env, 'VAPID_SUBJECT');
  if (vapidSubject && !/^(mailto:|https:\/\/)/.test(vapidSubject))
    fail(
      'VAPID_SUBJECT',
      'should be mailto:you@your-domain.in or an https:// address.',
    );

  const marketplaceToken = text(env, 'MARKETPLACE_TOKEN');
  if (marketplaceToken && marketplaceToken.length < 24)
    fail('MARKETPLACE_TOKEN', 'should be at least 24 random characters.');

  // ---------- Shipping (B5) ----------
  const shipping = text(env, 'SHIPPING_PROVIDER').toLowerCase();
  if (shipping && !['manual', 'shiprocket'].includes(shipping))
    fail('SHIPPING_PROVIDER', `"${shipping}" must be manual or shiprocket.`);
  if (shipping === 'shiprocket') {
    for (const name of [
      'SHIPROCKET_EMAIL',
      'SHIPROCKET_PASSWORD',
      'SHIPROCKET_PICKUP_LOCATION',
    ]) {
      if (!text(env, name))
        fail(
          name,
          'is needed when SHIPPING_PROVIDER is shiprocket (use a Shiprocket API user, not your own login).',
        );
    }
    if (!/^[1-9][0-9]{5}$/.test(text(env, 'SHIPPING_PICKUP_PINCODE')))
      fail(
        'SHIPPING_PICKUP_PINCODE',
        'should be the 6-digit PIN code parcels are picked up from.',
      );
    const hook = text(env, 'SHIPROCKET_WEBHOOK_TOKEN');
    if (!hook)
      warn(
        'SHIPROCKET_WEBHOOK_TOKEN',
        'is not set, so tracking updates from Shiprocket are refused and orders only move when you update them.',
      );
    else if (hook.length < 16)
      fail(
        'SHIPROCKET_WEBHOOK_TOKEN',
        'should be at least 16 random characters.',
      );
  }
  const weight = text(env, 'SHIPPING_DEFAULT_WEIGHT_KG');
  if (weight && !(Number(weight) > 0 && Number(weight) <= 50))
    fail(
      'SHIPPING_DEFAULT_WEIGHT_KG',
      'should be a weight in kg between 0 and 50, e.g. 0.5.',
    );

  // ---------- Analytics (D2) ----------
  require('../utils/analytics')
    .analyticsProblems(env)
    .forEach(([name, message]) => fail(name, message));

  // ---------- Monitoring and logs ----------
  const dsn = text(env, 'SENTRY_DSN');
  if (dsn) {
    let ok = false;
    try {
      const url = new URL(dsn);
      ok =
        /^https?:$/.test(url.protocol) &&
        Boolean(url.username) &&
        url.pathname.length > 1;
    } catch {
      /* not a URL */
    }
    if (!ok)
      fail(
        'SENTRY_DSN',
        'is not a Sentry DSN. It looks like https://<key>@<host>/<project-id>',
      );
  } else if (production) {
    warn(
      'SENTRY_DSN',
      'is not set, so server errors are only in the logs and nobody is alerted.',
    );
  }
  const level = text(env, 'LOG_LEVEL').toLowerCase();
  if (level && !LOG_LEVELS.includes(level))
    warn(
      'LOG_LEVEL',
      `"${level}" is not one of ${LOG_LEVELS.join(', ')}. Using info.`,
    );
  const format = text(env, 'LOG_FORMAT').toLowerCase();
  if (format && !['json', 'text'].includes(format))
    warn('LOG_FORMAT', `"${format}" is not json or text. Using the default.`);

  return {errors, warnings};
}

module.exports = {checkEnv, DURATIONS, RESERVED_PATHS, durationToMs, DURATION};
