// Production-readiness: start-up checks for the environment, request IDs and logging.
// These need no database.
require("./helpers");
const test = require("node:test");
const assert = require("node:assert/strict");
const { checkEnv } = require("../config/schema");
const context = require("../utils/requestContext");
const logger = require("../utils/logger");
const { requestId, VALID_ID } = require("../middleware/requestId");

const good = {
  NODE_ENV: "development",
  MONGODB_URI: "mongodb://127.0.0.1:27017/nexthlon",
  JWT_SECRET: "k3Jx9pQ2vLm8Zr5TnB7wYc1HdF4sGa6UeRo0XiNb"
};
const production = {
  ...good,
  NODE_ENV: "production",
  SITE_URL: "https://www.nexthlon.in",
  ADMIN_PATH: "/nx-console-7f3k",
  ADMIN_REQUIRE_2FA: "true",
  SMTP_HOST: "smtp.example.com", SMTP_USER: "u", SMTP_PASS: "p", MAIL_FROM: "Nexthlon <orders@nexthlon.in>",
  RAZORPAY_KEY_ID: "rzp_live_abc", RAZORPAY_KEY_SECRET: "s", RAZORPAY_WEBHOOK_SECRET: "w",
  SENTRY_DSN: "https://abc123@o1.ingest.sentry.io/42",
  STORAGE_DRIVER: "s3",
  S3_ENDPOINT: "https://abc.r2.cloudflarestorage.com",
  S3_BUCKET: "nexthlon",
  S3_ACCESS_KEY_ID: "key",
  S3_SECRET_ACCESS_KEY: "secret",
  STORAGE_PUBLIC_URL: "https://cdn.nexthlon.in",
  STORE_LEGAL_NAME: "Nexthlon Sports Private Limited", STORE_ADDRESS: "12 MG Road, Bengaluru, Karnataka 560001, India",
  STORE_GSTIN: "29ABCDE1234F1Z5", STORE_STATE: "Karnataka", STORE_SUPPORT_EMAIL: "support@nexthlon.in", STORE_SUPPORT_PHONE: "+91 80 4000 0000",
  STORE_GRIEVANCE_OFFICER: "A. Officer"
};

test("a good development setup has no errors and no warnings", () => {
  assert.deepEqual(checkEnv(good), { errors: [], warnings: [] });
});

test("a complete production setup has no errors and no warnings", () => {
  assert.deepEqual(checkEnv(production), { errors: [], warnings: [] });
});

test("a live shop is warned about placeholder business details, and a wrong support email stops it", () => {
  const { STORE_GSTIN, STORE_SUPPORT_PHONE, ...withoutTwo } = production;
  const { errors, warnings } = checkEnv(withoutTwo);
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings.map(line => line.split(":")[0]).sort(), ["STORE_GSTIN", "STORE_SUPPORT_PHONE"]);
  assert.match(checkEnv({ ...production, STORE_SUPPORT_EMAIL: "not-an-email" }).errors.join(" "), /STORE_SUPPORT_EMAIL/);
  assert.match(checkEnv({ ...production, STORE_GSTIN: "1234" }).warnings.join(" "), /STORE_GSTIN/);
});

test("every problem is reported at once, not one per run", () => {
  const { errors } = checkEnv({ NODE_ENV: "prod", PORT: "99999", TRUST_PROXY: "many", SENTRY_DSN: "nope" });
  const names = errors.map(line => line.split(":")[0]);
  for (const name of ["NODE_ENV", "MONGODB_URI", "JWT_SECRET", "PORT", "TRUST_PROXY", "SENTRY_DSN"]) {
    assert.ok(names.includes(name), `${name} should be reported`);
  }
});

test("required values and their formats", () => {
  assert.match(checkEnv({ ...good, MONGODB_URI: "" }).errors[0], /^MONGODB_URI: is missing/);
  assert.match(checkEnv({ ...good, MONGODB_URI: "http://example.com" }).errors[0], /must start with mongodb/);
  assert.match(checkEnv({ ...good, JWT_SECRET: "short" }).errors[0], /at least 32 characters/);
  // Long enough but guessable: only a warning in development, an error in production.
  const weak = "a".repeat(40);
  assert.equal(checkEnv({ ...good, JWT_SECRET: weak }).errors.length, 0);
  assert.match(checkEnv({ ...good, JWT_SECRET: weak }).warnings[0], /guessable/);
  assert.match(checkEnv({ ...production, JWT_SECRET: weak }).errors[0], /guessable/);
});

test("login lifetimes must be a duration within the limit", () => {
  assert.equal(checkEnv({ ...good, ACCESS_TOKEN_EXPIRES_IN: "30m" }).errors.length, 0);
  assert.match(checkEnv({ ...good, ACCESS_TOKEN_EXPIRES_IN: "2h" }).errors[0], /1h or less/);
  assert.match(checkEnv({ ...good, REFRESH_TOKEN_EXPIRES_IN: "forever" }).errors[0], /must look like/);
  assert.match(checkEnv({ ...good, ADMIN_REFRESH_TOKEN_EXPIRES_IN: "8d" }).errors[0], /7d or less/);
  assert.match(checkEnv({ ...good, JWT_EXPIRES_IN: "1d" }).warnings[0], /no longer read/);
});

test("the admin path: format, reserved paths, and the guessable default in production", () => {
  assert.match(checkEnv({ ...good, ADMIN_PATH: "/a" }).errors[0], /3 to 64/);
  assert.match(checkEnv({ ...good, ADMIN_PATH: "/products" }).errors[0], /already uses/);
  assert.match(checkEnv({ ...good, ADMIN_PATH: "/healthz" }).errors[0], /already uses/);
  assert.equal(checkEnv({ ...good, ADMIN_PATH: "console-7f3k" }).errors.length, 0);
  assert.ok(checkEnv({ ...production, ADMIN_PATH: "" }).warnings.some(line => /guessable default/.test(line)));
});

test("TRUST_PROXY is a number of proxies from 0 to 5", () => {
  for (const ok of ["0", "1", "2", "5"]) assert.equal(checkEnv({ ...good, TRUST_PROXY: ok }).errors.length, 0, ok);
  for (const bad of ["6", "-1", "true", "loopback", "1.5"]) assert.match(checkEnv({ ...good, TRUST_PROXY: bad }).errors[0], /^TRUST_PROXY/, bad);
});

test("SITE_URL is the store's address, and https in production", () => {
  assert.equal(checkEnv({ ...good, SITE_URL: "http://localhost:3000" }).errors.length, 0);
  assert.match(checkEnv({ ...good, SITE_URL: "www.nexthlon.in" }).errors[0], /no path/);
  assert.match(checkEnv({ ...good, SITE_URL: "https://nexthlon.in/shop" }).errors[0], /no path/);
  assert.match(checkEnv({ ...production, SITE_URL: "http://nexthlon.in" }).errors[0], /https/);
  // Reset and confirmation emails link to the store, so production cannot start without it.
  assert.ok(checkEnv({ ...production, SITE_URL: "" }).errors.some(line => line.startsWith("SITE_URL") && /link to the store/.test(line)));
});

test("Razorpay keys come as a pair, and test keys in production are called out", () => {
  assert.match(checkEnv({ ...good, RAZORPAY_KEY_ID: "rzp_test_x" }).errors[0], /RAZORPAY_KEY_SECRET: is missing/);
  assert.match(checkEnv({ ...good, RAZORPAY_KEY_SECRET: "s" }).errors[0], /RAZORPAY_KEY_ID: is missing/);
  assert.ok(checkEnv({ ...production, RAZORPAY_KEY_ID: "rzp_test_x" }).warnings.some(line => /TEST mode/.test(line)));
  assert.ok(checkEnv({ ...good, RAZORPAY_KEY_ID: "rzp_live_x", RAZORPAY_KEY_SECRET: "s", RAZORPAY_WEBHOOK_SECRET: "w" }).warnings.some(line => /LIVE key/.test(line)));
  assert.ok(checkEnv({ ...good, RAZORPAY_KEY_ID: "rzp_test_x", RAZORPAY_KEY_SECRET: "s" }).warnings.some(line => /WEBHOOK_SECRET/.test(line)));
});

test("production warns about what is missing: email, payments, alerts", () => {
  const { errors, warnings } = checkEnv({ ...good, NODE_ENV: "production", SITE_URL: "https://x.in" });
  assert.equal(errors.length, 0);
  for (const name of ["ADMIN_PATH", "RAZORPAY_KEY_ID", "SMTP_HOST", "SENTRY_DSN", "STORAGE_DRIVER", "ADMIN_REQUIRE_2FA"]) {
    assert.ok(warnings.some(line => line.startsWith(name)), `${name} should warn`);
  }
  // Development stays quiet about the same things.
  assert.deepEqual(checkEnv(good).warnings, []);
});

test("SENTRY_DSN must look like a Sentry address", () => {
  assert.equal(checkEnv({ ...good, SENTRY_DSN: "https://abc@o1.ingest.sentry.io/42" }).errors.length, 0);
  assert.match(checkEnv({ ...good, SENTRY_DSN: "https://o1.ingest.sentry.io/42" }).errors[0], /not a Sentry DSN/);
});

test("the loaded config uses the safe defaults", () => {
  const config = require("../config/env");
  assert.equal(config.trustProxy, 0, "no proxy outside production");
  assert.equal(config.sentry.enabled, false);
  assert.ok(Array.isArray(config.warnings));
  assert.match(config.release, /^nexthlon@/);
});

// ---------- Request IDs ----------
function fakeReq(headers = {}) {
  return { originalUrl: "/products?token=secret", method: "GET", get: name => headers[name.toLowerCase()] };
}
function fakeRes() {
  const headers = {};
  return { locals: {}, headers, statusCode: 200, setHeader: (key, value) => { headers[key] = value; }, on: () => {} };
}

test("each request gets a new ID, returned in X-Request-Id and available everywhere", async () => {
  const req = fakeReq();
  const res = fakeRes();
  let seen;
  await new Promise(resolve => requestId(req, res, () => { seen = context.requestId(); resolve(); }));
  assert.match(req.id, /^[0-9a-f-]{36}$/);
  assert.equal(res.headers["X-Request-Id"], req.id);
  assert.equal(res.locals.requestId, req.id);
  assert.equal(seen, req.id, "code run by next() can read the ID");
  assert.equal(context.requestId(), undefined, "and it does not leak outside the request");
});

test("a valid ID from the proxy is kept; an unsafe one is replaced", async () => {
  const keep = fakeReq({ "x-request-id": "abc-123_DEF.456" });
  await new Promise(resolve => requestId(keep, fakeRes(), resolve));
  assert.equal(keep.id, "abc-123_DEF.456");
  for (const bad of ["short", "has spaces in it", "x".repeat(65), "new\nline-injection", "<script>alert(1)</script>"]) {
    const req = fakeReq({ "x-request-id": bad });
    await new Promise(resolve => requestId(req, fakeRes(), resolve));
    assert.notEqual(req.id, bad);
    assert.match(req.id, /^[0-9a-f-]{36}$/);
  }
});

// ---------- The logger ----------
async function capture(level, fn, env = {}) {
  const saved = { LOG_LEVEL: process.env.LOG_LEVEL, LOG_FORMAT: process.env.LOG_FORMAT };
  Object.assign(process.env, { LOG_LEVEL: "debug", LOG_FORMAT: "text", ...env });
  const lines = [];
  const original = console[level];
  console[level] = line => lines.push(line);
  try {
    await fn();
  } finally {
    console[level] = original;
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  return lines;
}

test("log lines carry the request ID, and hide secrets", async () => {
  const lines = await capture("info", () => context.run({ requestId: "req-abc-12345" }, () => {
    logger.info("order.placed", { orderId: "o1", password: "hunter2", cardNumber: "4111", token: "t" });
  }));
  assert.equal(lines.length, 1);
  assert.match(lines[0], / INFO order\.placed req=req-abc-12345 orderId=o1$/);
  assert.doesNotMatch(lines[0], /hunter2|4111/);
});

test("LOG_FORMAT=json writes one object per line with the same fields", async () => {
  const lines = await capture("warn", () => context.run({ requestId: "req-json-12345" }, () => {
    logger.warn("payment.late", { orderId: "o9", error: new Error("gateway timeout"), secret: "x" });
  }), { LOG_FORMAT: "json" });
  const entry = JSON.parse(lines[0]);
  assert.equal(entry.level, "warn");
  assert.equal(entry.event, "payment.late");
  assert.equal(entry.req, "req-json-12345");
  assert.equal(entry.orderId, "o9");
  assert.equal(entry.error, "gateway timeout");
  assert.equal(entry.secret, undefined);
  assert.ok(!Number.isNaN(Date.parse(entry.time)));
});

test("the logger stays silent in tests unless LOG_LEVEL is set", () => {
  const saved = process.env.LOG_LEVEL;
  delete process.env.LOG_LEVEL;
  const lines = [];
  const original = console.error;
  console.error = line => lines.push(line);
  try {
    logger.error("should.not.print");
  } finally {
    console.error = original;
    if (saved !== undefined) process.env.LOG_LEVEL = saved;
  }
  assert.deepEqual(lines, []);
});

// ---------- The error handler ----------
const { errorHandler } = require("../middleware/errorHandler");

function errorCall(error, { api = false, id = "req-err-12345" } = {}) {
  const sent = {};
  const req = { id, method: "POST", originalUrl: (api ? "/api/orders" : "/checkout") + "?token=secret" };
  const res = {
    headersSent: false,
    set(name, value) { sent.headers = { ...sent.headers, [name]: value }; return this; },
    status(code) { sent.status = code; return this; },
    json(body) { sent.json = body; return this; },
    render(view, locals) { sent.view = view; sent.locals = locals; return this; }
  };
  errorHandler(error, req, res, () => {});
  return sent;
}

test("a server error is logged with its request ID, and the shopper never sees the details", async () => {
  let sent;
  const lines = await capture("error", () => {
    sent = errorCall(new Error("E11000 secret database detail"), { api: true });
  });
  assert.equal(sent.status, 500);
  assert.match(sent.json.message, /Something went wrong on our side/);
  assert.doesNotMatch(JSON.stringify(sent.json), /secret database detail/);
  assert.equal(sent.json.requestId, "req-err-12345", "the reference to quote when asking for help");
  assert.match(sent.headers["Cache-Control"], /no-store/, "a failure is never kept by a CDN");
  const [line] = lines;
  assert.match(line, / ERROR http\.error /);
  assert.match(line, /path=\/api\/orders/);
  assert.doesNotMatch(line, /token=secret/, "the query string can hold tokens, so it is not logged");
});

test("client errors are not logged as server errors and carry no request ID in the reply", async () => {
  const { HttpError } = require("../utils/http");
  let sent;
  const lines = await capture("error", () => { sent = errorCall(new HttpError(400, "Pick a size."), { api: true }); });
  assert.equal(sent.status, 400);
  assert.deepEqual(sent.json, { message: "Pick a size." });
  assert.deepEqual(lines, []);
});

test("a page error renders the error page, which gets the request ID", async () => {
  let sent;
  await capture("error", () => { sent = errorCall(new Error("boom")); });
  assert.equal(sent.status, 500);
  assert.equal(sent.view, "pages/error");
});

// ---------- Start-up, as a real process ----------
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const root = path.join(__dirname, "..");

function run(code, env) {
  return spawnSync(process.execPath, ["-e", code], { cwd: root, env: { PATH: process.env.PATH, ...env }, encoding: "utf8" });
}

test("a bad .env stops the server and lists every problem", () => {
  const result = spawnSync(process.execPath, ["server.js"], {
    cwd: root, encoding: "utf8", timeout: 20_000,
    env: { PATH: process.env.PATH, NODE_ENV: "prod", JWT_SECRET: "short", TRUST_PROXY: "many", MONGODB_URI: "mongodb://127.0.0.1:1/x" }
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Startup failed: The settings in \.env are not valid/);
  for (const name of ["NODE_ENV", "JWT_SECRET", "TRUST_PROXY"]) assert.match(result.stderr, new RegExp(`- ${name}:`));
});

test("TRUST_PROXY: off in development, one proxy by default in production, or the number you set", () => {
  const base = { MONGODB_URI: "mongodb://127.0.0.1:1/x", JWT_SECRET: good.JWT_SECRET, SITE_URL: "https://www.nexthlon.in", ADMIN_PATH: "/nx-console-7f3k" };
  const read = env => JSON.parse(run("process.stdout.write(JSON.stringify(require('./config/env').trustProxy))", { ...base, ...env }).stdout);
  assert.equal(read({ NODE_ENV: "development" }), 0);
  assert.equal(read({ NODE_ENV: "production" }), 1);
  assert.equal(read({ NODE_ENV: "production", TRUST_PROXY: "2" }), 2);
  assert.equal(read({ NODE_ENV: "production", TRUST_PROXY: "0" }), 0);
});

// ---------- The photo bucket and the browser ----------
test("with a bucket, the Content Security Policy lets the browser load photos from it; without one it does not", () => {
  const script = "const app = require('./app'); const s = app.listen(0, async () => { const r = await fetch('http://127.0.0.1:' + s.address().port + '/api/health'); process.stdout.write(r.headers.get('content-security-policy')); s.close(); process.exit(0); });";
  // STORAGE_DRIVER is set so a photo service in your own .env (dotenv fills only what is missing) can't change the answer.
  const env = { MONGODB_URI: "mongodb://127.0.0.1:1/x", JWT_SECRET: good.JWT_SECRET, NODE_ENV: "development", LOG_LEVEL: "error", STORAGE_DRIVER: "local" };
  const withBucket = run(script, { ...env, STORAGE_DRIVER: "s3", S3_ENDPOINT: "https://abc.r2.cloudflarestorage.com", S3_BUCKET: "b", S3_ACCESS_KEY_ID: "k", S3_SECRET_ACCESS_KEY: "s", STORAGE_PUBLIC_URL: "https://cdn.nexthlon.in/" }).stdout;
  assert.match(withBucket, /img-src 'self' data: https:\/\/images\.unsplash\.com https:\/\/cdn\.razorpay\.com https:\/\/cdn\.nexthlon\.in;/);
  const without = run(script, env).stdout;
  assert.match(without, /img-src 'self' data: https:\/\/images\.unsplash\.com https:\/\/cdn\.razorpay\.com;/);
  assert.doesNotMatch(without, /cdn\.nexthlon\.in/);
});

test("the GST state must be a real state and match the GSTIN", () => {
  const base = { ...production };
  const wrongState = checkEnv({ ...base, STORE_STATE: "Atlantis" });
  assert.ok(wrongState.errors.some(line => line.startsWith("STORE_STATE")));
  const mismatch = checkEnv({ ...base, STORE_STATE: "Kerala" });
  assert.ok(mismatch.warnings.some(line => line.startsWith("STORE_STATE") && /starts with 29/.test(line)));
  assert.ok(checkEnv({ ...base, STORE_GST_SCHEME: "simple" }).errors.some(line => line.startsWith("STORE_GST_SCHEME")));
});
