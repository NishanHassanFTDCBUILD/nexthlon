// Forgot password, email confirmation and the admin's two-step login, end to end against a real MongoDB
// test database. They only run when TEST_MONGODB_URI is set, and refuse any database whose name lacks "test".
require("./helpers");
const test = require("node:test");
const assert = require("node:assert/strict");

if (!process.env.TEST_MONGODB_URI) {
  test("recovery tests (set TEST_MONGODB_URI to run them)", { skip: true }, () => {});
  return;
}

const http = require("node:http");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const app = require("../app");
const config = require("../config/env");
const User = require("../models/User");
const AuthToken = require("../models/AuthToken");
const RefreshToken = require("../models/RefreshToken");
const AuditLog = require("../models/AuditLog");
const mailService = require("../services/mailService");
const authTokenService = require("../services/authTokenService");
const passwordResetService = require("../services/passwordResetService");
const twoFactor = require("../services/twoFactorService");
const { hashPassword } = require("../services/authService");
const { idle } = require("../utils/background");
const { renderEmail } = require("../utils/emailLayout");
const { toPublicUser } = require("../utils/publicUser");

const dbUrl = new URL(process.env.TEST_MONGODB_URI);
dbUrl.pathname = `${dbUrl.pathname.replace(/\/$/, "")}_recovery`;

let server;
let base;
let outbox;
let visitor = 0;

// Every call comes from its own pretend visitor address, so the rate limits (per address) do not
// get in the way of tests that are not about them. The tests that are about them fix the address.
app.set("trust proxy", 1);

async function call(method, path, { body, cookie, headers = {}, ip } = {}) {
  const requestHeaders = { Accept: "application/json", Origin: base, "X-Forwarded-For": ip || `10.1.${Math.floor(visitor / 250)}.${(visitor += 1) % 250}`, ...headers };
  if (body !== undefined) requestHeaders["Content-Type"] = "application/json";
  if (cookie) requestHeaders.Cookie = cookie;
  const response = await fetch(base + path, { method, headers: requestHeaders, redirect: "manual", body: body === undefined ? undefined : JSON.stringify(body) });
  const type = response.headers.get("content-type") || "";
  const data = type.includes("json") ? await response.json() : await response.text();
  const cookies = Object.fromEntries(response.headers.getSetCookie().map(line => line.split(";")[0].split("=")).filter(([, value]) => value));
  return { status: response.status, data, headers: response.headers, location: response.headers.get("location"), cookies };
}

const cookieOf = result => Object.entries(result.cookies).map(([name, value]) => `${name}=${value}`).join("; ");
const login = (email, password) => call("POST", "/api/login", { body: { email, password } });
const adminLogin = (email, password) => call("POST", "/api/admin/login", { body: { email, password } });
const tokenIn = mail => (mail.text.match(/token=([a-f0-9]{64})/) || [])[1];
const lastMail = () => outbox[outbox.length - 1];

const PASSWORD = "Trail2024!";
const NEW_PASSWORD = "Summit2025#";
let seq = 0;
async function makeUser(overrides = {}) {
  seq += 1;
  return User.create({ name: `Person ${seq}`, email: `person${seq}@recovery.test`, passwordHash: await hashPassword(PASSWORD), role: "customer", ...overrides });
}

// The 6-digit code an authenticator app would show right now (or a step away).
const codeFor = (base32Secret, stepOffset = 0) => twoFactor.hotp(twoFactor.base32Decode(base32Secret.replace(/\s/g, "")), twoFactor.currentStep() + stepOffset);
const wrongCode = secret => {
  const valid = [-2, -1, 0, 1, 2].map(offset => codeFor(secret, offset));
  return ["111111", "222222", "333333"].find(code => !valid.includes(code));
};

test.before(async () => {
  if (!/test/i.test(dbUrl.pathname)) throw new Error("The test database must have 'test' in its name.");
  await mongoose.connect(dbUrl.href);
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map(model => model.syncIndexes()));
  server = app.listen(0);
  await new Promise(resolve => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  outbox = [];
  mailService.useTestOutbox(outbox);
});

test.after(async () => {
  mailService.useTestOutbox(null);
  await idle();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  await new Promise(resolve => server.close(resolve));
});

test.beforeEach(() => { outbox.length = 0; });

// =============================== Forgot password ===============================

test("asking for a reset sends one email with a one-time link, and the reply is the same for everyone", async () => {
  const known = await makeUser();
  const blocked = await makeUser({ isBlocked: true });
  const deleted = await makeUser({ isDeleted: true });
  const admin = await makeUser({ role: "admin" });

  const replies = [];
  for (const email of [known.email, "nobody@recovery.test", blocked.email, deleted.email, admin.email]) {
    const reply = await call("POST", "/api/password/forgot", { body: { email } });
    assert.equal(reply.status, 200, email);
    replies.push(JSON.stringify(reply.data));
  }
  assert.equal(new Set(replies).size, 1, "identical reply: nothing says which addresses have accounts");
  await idle();

  // Only the real, active customer got an email. Not an unknown address, not a blocked or deleted account,
  // and not an admin (an admin's password is changed from the command line).
  assert.equal(outbox.length, 1);
  const mail = outbox[0];
  assert.equal(mail.to, known.email);
  assert.match(mail.subject, /Reset your Nexthlon password/);
  assert.match(mail.text, /works once, for 30 minutes/);
  assert.match(mail.text, new RegExp(`${base.replace(/\./g, "\\.")}/reset-password\\?token=[a-f0-9]{64}`));
  assert.match(mail.html, /Choose a new password/);

  // The row holds a hash, never the token itself, and it expires in 30 minutes.
  const raw = tokenIn(mail);
  const row = await AuthToken.findOne({ user: known._id, purpose: "password_reset" });
  assert.equal(row.tokenHash, authTokenService.hashToken(raw));
  assert.notEqual(row.tokenHash, raw);
  assert.ok(Math.abs(row.expiresAt.getTime() - Date.now() - 30 * 60 * 1000) < 5000);
});

test("the request answers before any email work: bad input is refused, good input does not wait", async () => {
  assert.equal((await call("POST", "/api/password/forgot", { body: { email: "not-an-email" } })).status, 400);
  assert.equal((await call("POST", "/api/password/forgot", { body: {} })).status, 400);
  const user = await makeUser();
  const slowMail = [];
  mailService.useTestOutbox({ push: mail => { slowMail.push(mail); } });
  try {
    const before = Date.now();
    const reply = await call("POST", "/api/password/forgot", { body: { email: user.email } });
    assert.equal(reply.status, 200);
    assert.ok(Date.now() - before < 2000);
    await idle();
    assert.equal(slowMail.length, 1);
  } finally {
    mailService.useTestOutbox(outbox);
  }
});

test("one account gets at most 3 reset emails an hour, however often it is asked", async () => {
  const user = await makeUser();
  for (let i = 0; i < 5; i += 1) await call("POST", "/api/password/forgot", { body: { email: user.email } });
  await idle();
  assert.equal(outbox.length, passwordResetService.MAX_PER_HOUR);
});

test("a new link replaces the older one: only the newest works", async () => {
  const user = await makeUser();
  await call("POST", "/api/password/forgot", { body: { email: user.email } });
  await idle();
  await call("POST", "/api/password/forgot", { body: { email: user.email } });
  await idle();
  const [older, newer] = outbox.map(tokenIn);
  assert.notEqual(older, newer);
  const stale = await call("POST", "/api/password/reset", { body: { token: older, password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD } });
  assert.equal(stale.status, 400);
  assert.match(stale.data.message, /expired or was already used/);
  assert.equal((await call("POST", "/api/password/reset", { body: { token: newer, password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD } })).status, 200);
});

test("the reset page: a good link shows the form, a bad one says it has expired, and the token stays private", async () => {
  const user = await makeUser();
  await call("POST", "/api/password/forgot", { body: { email: user.email } });
  await idle();
  const token = tokenIn(lastMail());

  const good = await call("GET", `/reset-password?token=${token}`, { headers: { Accept: "text/html" } });
  assert.equal(good.status, 200);
  assert.match(good.data, /Choose a new password/);
  assert.match(good.data, new RegExp(`name="token" value="${token}"`));
  assert.equal(good.headers.get("referrer-policy"), "no-referrer", "the link's token is not sent to other sites");
  assert.match(good.headers.get("cache-control"), /no-store/);
  // Opening the page does not use the link up.
  assert.equal((await call("GET", `/reset-password?token=${token}`, { headers: { Accept: "text/html" } })).status, 200);
  assert.ok(await authTokenService.isUsable(token, "password_reset"));

  for (const bad of ["", "abc", "z".repeat(64), "a".repeat(64)]) {
    const page = await call("GET", `/reset-password?token=${bad}`, { headers: { Accept: "text/html" } });
    assert.equal(page.status, 200);
    assert.match(page.data, /This link has expired/);
    assert.doesNotMatch(page.data, /name="password"/);
  }
});

test("choosing a new password: it works, the old one stops, every device is signed out, and the link is spent", async () => {
  const user = await makeUser();
  const phone = await login(user.email, PASSWORD);
  const laptop = await login(user.email, PASSWORD);
  assert.equal((await call("GET", "/api/me", { cookie: cookieOf(phone) })).status, 200);

  await call("POST", "/api/password/forgot", { body: { email: user.email } });
  await idle();
  const token = tokenIn(lastMail());
  outbox.length = 0;

  const reset = await call("POST", "/api/password/reset", { body: { token, password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD } });
  assert.equal(reset.status, 200);
  assert.equal(reset.data.redirect, "/login?reason=password_reset");

  assert.equal((await login(user.email, PASSWORD)).status, 401, "the old password no longer works");
  assert.equal((await login(user.email, NEW_PASSWORD)).status, 200);
  // Both signed-in devices are out: their access tokens (tokenVersion) and refresh tokens (revoked).
  assert.equal((await call("GET", "/api/me", { cookie: cookieOf(phone) })).status, 401);
  assert.equal((await call("GET", "/api/me", { cookie: cookieOf(laptop) })).status, 401);
  const old = await RefreshToken.find({ user: user._id, revokedReason: "password_reset" });
  assert.ok(old.length >= 2);

  // The link was one use.
  const again = await call("POST", "/api/password/reset", { body: { token, password: "Another2026$", confirmPassword: "Another2026$" } });
  assert.equal(again.status, 400);

  // The owner is told, the address counts as confirmed, and it is in the audit log (without the password).
  await idle();
  assert.equal(outbox.length, 1);
  assert.match(outbox[0].subject, /password was changed/i);
  assert.match(outbox[0].text, /signed out on every device/);
  assert.ok((await User.findById(user._id)).emailVerifiedAt, "the link proved the inbox");
  const audit = await AuditLog.findOne({ action: "auth.password_reset", actor: user._id }).lean();
  assert.ok(audit);
  assert.doesNotMatch(JSON.stringify(audit), new RegExp(NEW_PASSWORD));
});

test("a weak or mismatched password is refused without spending the link", async () => {
  const user = await makeUser();
  await call("POST", "/api/password/forgot", { body: { email: user.email } });
  await idle();
  const token = tokenIn(lastMail());

  const weak = await call("POST", "/api/password/reset", { body: { token, password: "short", confirmPassword: "short" } });
  assert.equal(weak.status, 400);
  assert.ok(weak.data.errors.password);
  const mismatch = await call("POST", "/api/password/reset", { body: { token, password: NEW_PASSWORD, confirmPassword: "Different2026!" } });
  assert.ok(mismatch.data.errors.confirmPassword);
  const noToken = await call("POST", "/api/password/reset", { body: { password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD } });
  assert.equal(noToken.status, 400);

  assert.ok(await authTokenService.isUsable(token, "password_reset"), "still usable");
  assert.equal((await call("POST", "/api/password/reset", { body: { token, password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD } })).status, 200);
});

test("an expired link does not work, and neither does one for an admin or a deleted account", async () => {
  const user = await makeUser();
  const raw = await authTokenService.issue(user, "password_reset");
  await AuthToken.updateOne({ tokenHash: authTokenService.hashToken(raw) }, { expiresAt: new Date(Date.now() - 1000) });
  assert.equal((await call("POST", "/api/password/reset", { body: { token: raw, password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD } })).status, 400);

  // Tokens can only be made for the right accounts, but if one existed for an admin it must still be refused.
  const admin = await makeUser({ role: "admin" });
  const adminRaw = await authTokenService.issue(admin, "password_reset");
  const refused = await call("POST", "/api/password/reset", { body: { token: adminRaw, password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD } });
  assert.equal(refused.status, 400);
  assert.equal((await adminLogin(admin.email, PASSWORD)).status, 200, "the admin's password did not change");

  const gone = await makeUser();
  const goneRaw = await authTokenService.issue(gone, "password_reset");
  await User.updateOne({ _id: gone._id }, { isDeleted: true });
  assert.equal((await call("POST", "/api/password/reset", { body: { token: goneRaw, password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD } })).status, 400);
});

test("two requests with the same link at the same instant: exactly one wins", async () => {
  const user = await makeUser();
  const raw = await authTokenService.issue(user, "password_reset");
  const attempts = await Promise.all(["Summit2025#", "Summit2025$", "Summit2025%", "Summit2025^"].map(password =>
    call("POST", "/api/password/reset", { body: { token: raw, password, confirmPassword: password } })));
  assert.equal(attempts.filter(reply => reply.status === 200).length, 1);
  assert.equal(attempts.filter(reply => reply.status === 400).length, 3);
});

test("asking for resets is rate limited per visitor address", async () => {
  const user = await makeUser();
  const statuses = [];
  for (let i = 0; i < 7; i += 1) statuses.push((await call("POST", "/api/password/forgot", { body: { email: user.email }, ip: "203.0.113.50" })).status);
  assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429, 429]);
});

// =============================== Confirming the email ===============================

test("signing up sends a confirmation link; opening the page uses nothing; confirming marks the address", async () => {
  const signup = await call("POST", "/api/signup", { body: { name: "Meera Iyer", email: "meera@recovery.test", password: PASSWORD, confirmPassword: PASSWORD } });
  assert.equal(signup.status, 201);
  assert.equal(signup.data.user.emailVerified, false);
  await idle();
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].to, "meera@recovery.test");
  assert.match(outbox[0].subject, /Confirm your email/);
  assert.match(outbox[0].text, /works for 48 hours|48 hours/);
  const token = tokenIn(outbox[0]);

  const page = await call("GET", `/verify-email?token=${token}`, { headers: { Accept: "text/html" } });
  assert.match(page.data, /Confirm my email/);
  assert.equal((await User.findOne({ email: "meera@recovery.test" })).emailVerifiedAt, null, "a page view (or a mail scanner) confirms nothing");

  const confirmed = await call("POST", "/api/email/verify", { body: { token } });
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.data.user.emailVerified, true);
  assert.ok((await User.findOne({ email: "meera@recovery.test" })).emailVerifiedAt);
  assert.equal((await call("POST", "/api/email/verify", { body: { token } })).status, 400, "one use");
  assert.match((await call("GET", `/verify-email?token=${token}`, { headers: { Accept: "text/html" } })).data, /This link has expired/);
  assert.equal((await call("POST", "/api/email/verify", { body: { token: "nope" } })).status, 400);
});

test("a signed-in customer with an unconfirmed email sees a reminder and can ask for the link again", async () => {
  const user = await makeUser();
  const session = await login(user.email, PASSWORD);
  const cookie = cookieOf(session);

  const account = await call("GET", "/account", { cookie, headers: { Accept: "text/html" } });
  assert.match(account.data, /data-verify-banner/);
  assert.match(account.data, /Confirm your email/);

  const resend = await call("POST", "/api/account/email/resend", { cookie });
  assert.equal(resend.status, 200);
  assert.match(resend.data.message, new RegExp(user.email.replace(/\./g, "\\.")));
  assert.equal(outbox.length, 1);
  const first = tokenIn(outbox[0]);
  // Asking again replaces the link: only the newest works.
  await call("POST", "/api/account/email/resend", { cookie });
  assert.equal((await call("POST", "/api/email/verify", { body: { token: first } })).status, 400);
  const second = tokenIn(lastMail());
  assert.equal((await call("POST", "/api/email/verify", { body: { token: second } })).status, 200);

  // Confirmed: the reminder is gone, and there is nothing to resend.
  assert.doesNotMatch((await call("GET", "/account", { cookie, headers: { Accept: "text/html" } })).data, /data-verify-banner/);
  assert.equal((await call("POST", "/api/account/email/resend", { cookie })).status, 400);
  assert.equal((await call("POST", "/api/account/email/resend", {})).status, 401, "signed-in customers only");
});

test("at most 4 confirmation emails an hour per account", async () => {
  const user = await makeUser();
  const cookie = cookieOf(await login(user.email, PASSWORD));
  const statuses = [];
  for (let i = 0; i < 6; i += 1) statuses.push((await call("POST", "/api/account/email/resend", { cookie })).status);
  assert.deepEqual(statuses, [200, 200, 200, 200, 429, 429]);
  assert.equal(outbox.length, 4);
});

test("changing the email needs the new address confirmed, and an old link cannot confirm it", async () => {
  const user = await makeUser();
  const cookie = cookieOf(await login(user.email, PASSWORD));
  await call("POST", "/api/account/email/resend", { cookie });
  const oldLink = tokenIn(lastMail());
  assert.equal((await call("POST", "/api/email/verify", { body: { token: oldLink } })).status, 200);
  assert.ok((await User.findById(user._id)).emailVerifiedAt);

  outbox.length = 0;
  const changed = await call("PATCH", "/api/account/email", { cookie, body: { email: "new-address@recovery.test", password: PASSWORD } });
  assert.equal(changed.status, 200, JSON.stringify(changed.data));
  assert.equal(changed.data.user.emailVerified, false);
  await idle();
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].to, "new-address@recovery.test");

  // A confirmation link made for the earlier address is refused for the new one.
  // (Written straight into the collection: issuing a link would replace the newest one.)
  const staleRaw = authTokenService.newToken();
  await AuthToken.create({ user: user._id, purpose: "email_verify", tokenHash: authTokenService.hashToken(staleRaw), sentTo: user.email, expiresAt: new Date(Date.now() + 3600_000), deleteAt: new Date(Date.now() + 7200_000) });
  const stale = await call("POST", "/api/email/verify", { body: { token: staleRaw } });
  assert.equal(stale.status, 400);
  assert.match(stale.data.message, /earlier email address/);
  assert.equal((await call("POST", "/api/email/verify", { body: { token: tokenIn(outbox[0]) } })).status, 200);
});

test("a password changed from the account sends the owner a notice", async () => {
  const user = await makeUser();
  const cookie = cookieOf(await login(user.email, PASSWORD));
  const reply = await call("PATCH", "/api/profile/password", { cookie, body: { currentPassword: PASSWORD, newPassword: NEW_PASSWORD, confirmPassword: NEW_PASSWORD } });
  assert.equal(reply.status, 200);
  await idle();
  assert.ok(outbox.some(mail => mail.to === user.email && /password was changed/i.test(mail.subject)));
});

// =============================== The links in emails ===============================

test("links use SITE_URL when it is set, never the request's Host header", async () => {
  const user = await makeUser();
  const saved = config.siteUrl;
  config.siteUrl = "https://shop.example.in";
  try {
    // A forged Host header (and a matching Origin, so the request gets past the cross-site check).
    await new Promise((resolve, reject) => {
      const body = JSON.stringify({ email: user.email });
      const request = http.request(base + "/api/password/forgot", {
        method: "POST",
        headers: { Host: "evil.example", Origin: "http://evil.example", "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), "X-Forwarded-For": "10.9.9.9" }
      }, response => { response.resume(); response.on("end", resolve); });
      request.on("error", reject);
      request.end(body);
    });
    await idle();
    assert.match(lastMail().text, /https:\/\/shop\.example\.in\/reset-password\?token=/);
    assert.doesNotMatch(lastMail().text, /evil\.example/);
  } finally {
    config.siteUrl = saved;
  }
});

test("emails escape what they are given, and always have a plain-text version", () => {
  const { html, text } = renderEmail({ preheader: "x", heading: "Hi <b>there</b>", paragraphs: ['A "quoted" <script>alert(1)</script> line'], button: { label: "Go", url: "https://shop.example/a?b=1&c=2" } });
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /href="https:\/\/shop\.example\/a\?b=1&amp;c=2"/);
  assert.match(text, /https:\/\/shop\.example\/a\?b=1&c=2/);
  assert.match(html, /lang="en"/);
});

// =============================== The code behind two-step login ===============================

test("the codes match the standard's test vectors (RFC 6238, SHA-1, 6 digits)", () => {
  const secret = Buffer.from("12345678901234567890");
  for (const [seconds, expected] of [[59, "287082"], [1111111109, "081804"], [1111111111, "050471"], [1234567890, "005924"], [2000000000, "279037"], [20000000000, "353130"]]) {
    assert.equal(twoFactor.hotp(secret, Math.floor(seconds / 30)), expected, `at ${seconds}s`);
    assert.equal(twoFactor.matchStep(secret, expected, seconds * 1000), Math.floor(seconds / 30));
  }
  // One step either side is accepted (clock drift), two is not.
  const t = 1111111109 * 1000;
  assert.equal(twoFactor.matchStep(secret, twoFactor.hotp(secret, Math.floor(t / 30000) - 1), t), Math.floor(t / 30000) - 1);
  assert.equal(twoFactor.matchStep(secret, twoFactor.hotp(secret, Math.floor(t / 30000) + 2), t), null);
  assert.equal(twoFactor.matchStep(secret, "12345", t), null);
});

test("base32, encryption and code formats", () => {
  const bytes = Buffer.from("Nexthlon two-step test secret!");
  assert.deepEqual(twoFactor.base32Decode(twoFactor.base32Encode(bytes)), bytes);
  assert.equal(twoFactor.base32Encode(Buffer.from("foobar")), "MZXW6YTBOI");
  assert.throws(() => twoFactor.base32Decode("not base32!"));

  const stored = twoFactor.encrypt("JBSWY3DPEHPK3PXP");
  assert.match(stored, /^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
  assert.doesNotMatch(stored, /JBSWY3DPEHPK3PXP/);
  assert.equal(twoFactor.decrypt(stored), "JBSWY3DPEHPK3PXP");
  assert.notEqual(twoFactor.encrypt("JBSWY3DPEHPK3PXP"), stored, "a fresh random IV every time");
  // Flip one bit of the encrypted bytes (changing a base64 character could land in unused bits and change nothing).
  const [version, iv, tag, body] = stored.split(".");
  const bodyBytes = Buffer.from(body, "base64url");
  bodyBytes[0] ^= 1;
  assert.throws(() => twoFactor.decrypt([version, iv, tag, bodyBytes.toString("base64url")].join(".")), "a changed byte is detected");
  const tagBytes = Buffer.from(tag, "base64url");
  tagBytes[0] ^= 1;
  assert.throws(() => twoFactor.decrypt([version, iv, tagBytes.toString("base64url"), body].join(".")), "a changed tag is detected");
  assert.throws(() => twoFactor.decrypt("v2.a.b.c"));

  assert.deepEqual(twoFactor.classify("123 456"), { kind: "totp", value: "123456" });
  assert.deepEqual(twoFactor.classify(" 123456 "), { kind: "totp", value: "123456" });
  const code = twoFactor.newRecoveryCode();
  assert.match(code, /^[a-hj-km-np-z2-9]{5}-[a-hj-km-np-z2-9]{5}$/);
  assert.equal(twoFactor.classify(code.toUpperCase()).kind, "recovery");
  assert.equal(twoFactor.classify(code.replace("-", " ")).kind, "recovery");
  for (const bad of ["", "12345", "1234567", "abcdefghij0", "o0o0o-1l1l1", null, undefined, "x".repeat(40)]) assert.equal(twoFactor.classify(bad), null, String(bad));
});

// =============================== Admin two-step login ===============================

async function enableTwoFactor(admin) {
  const session = await adminLogin(admin.email, PASSWORD);
  assert.equal(session.status, 200);
  const cookie = cookieOf(session);
  const setup = await call("POST", "/api/admin/2fa/setup", { cookie });
  assert.equal(setup.status, 200, JSON.stringify(setup.data));
  const secret = setup.data.secret.replace(/\s/g, "");
  const enabled = await call("POST", "/api/admin/2fa/enable", { cookie, body: { code: codeFor(secret) } });
  assert.equal(enabled.status, 200, JSON.stringify(enabled.data));
  return { cookie, secret, recoveryCodes: enabled.data.recoveryCodes, setup };
}

test("setting up two-step login: a QR code, a first code to prove it, recovery codes, and nothing readable in the database", async () => {
  const admin = await makeUser({ role: "admin" });
  const cookie = cookieOf(await adminLogin(admin.email, PASSWORD));
  assert.deepEqual((await call("GET", "/api/admin/2fa", { cookie })).data, { enabled: false, enabledAt: null, recoveryCodesLeft: 0, required: false });

  const setup = await call("POST", "/api/admin/2fa/setup", { cookie });
  assert.equal(setup.status, 200);
  assert.match(setup.data.qr, /^data:image\/svg\+xml;base64,/);
  assert.match(Buffer.from(setup.data.qr.split(",")[1], "base64").toString(), /^<svg/);
  const secret = setup.data.secret.replace(/\s/g, "");
  assert.match(secret, /^[A-Z2-7]{32}$/);
  assert.match(setup.data.uri, new RegExp(`^otpauth://totp/Nexthlon%3A${encodeURIComponent(admin.email).replace(/\./g, "\\.")}\\?secret=${secret}&issuer=Nexthlon&algorithm=SHA1&digits=6&period=30$`));

  // Not on yet, and a wrong first code does not turn it on.
  assert.equal((await adminLogin(admin.email, PASSWORD)).data.twoFactorRequired, undefined);
  const wrong = await call("POST", "/api/admin/2fa/enable", { cookie, body: { code: wrongCode(secret) } });
  assert.equal(wrong.status, 400, "a form problem, not a signed-out session (the page would send the admin to sign in again on a 401)");
  assert.equal((await call("POST", "/api/admin/2fa/enable", { cookie, body: {} })).status, 400);

  const enabled = await call("POST", "/api/admin/2fa/enable", { cookie, body: { code: codeFor(secret) } });
  assert.equal(enabled.status, 200);
  assert.equal(enabled.data.recoveryCodes.length, 10);
  assert.equal(new Set(enabled.data.recoveryCodes).size, 10);
  assert.match(enabled.data.recoveryCodes[0], /^[a-z2-9-]{11}$/);

  // The database keeps the secret encrypted and the recovery codes only as hashes.
  const stored = await User.findById(admin._id).select("+twoFactor.secretEnc +twoFactor.recoveryHashes +twoFactor.pendingSecretEnc");
  assert.equal(stored.twoFactor.enabled, true);
  assert.equal(twoFactor.decrypt(stored.twoFactor.secretEnc), secret);
  assert.ok(!stored.twoFactor.secretEnc.includes(secret));
  assert.equal(stored.twoFactor.pendingSecretEnc, "");
  assert.equal(stored.twoFactor.recoveryHashes.length, 10);
  for (const code of enabled.data.recoveryCodes) {
    assert.ok(!stored.twoFactor.recoveryHashes.includes(code));
    assert.ok(stored.twoFactor.recoveryHashes.includes(twoFactor.hashRecovery(code)));
  }
  // Nothing of it is ever sent to a browser, or found by an ordinary read.
  const ordinary = await User.findById(admin._id);
  assert.equal(ordinary.twoFactor.secretEnc, undefined);
  assert.equal(toPublicUser(ordinary).twoFactor, undefined);
  assert.ok(!JSON.stringify(toPublicUser(ordinary)).includes(secret));

  assert.equal((await call("POST", "/api/admin/2fa/setup", { cookie })).status, 409, "already on");
  assert.deepEqual((await call("GET", "/api/admin/2fa", { cookie })).data.recoveryCodesLeft, 10);
  assert.ok(await AuditLog.exists({ action: "auth.2fa_enabled", actor: admin._id }));
  await idle();
  assert.ok(outbox.some(mail => mail.to === admin.email && /Two-step login turned on/.test(mail.subject)));
});

test("the setup endpoints are for signed-in admins only", async () => {
  const customer = await makeUser();
  const customerCookie = cookieOf(await login(customer.email, PASSWORD));
  for (const [method, path] of [["GET", "/api/admin/2fa"], ["POST", "/api/admin/2fa/setup"], ["POST", "/api/admin/2fa/enable"], ["POST", "/api/admin/2fa/disable"], ["POST", "/api/admin/2fa/recovery-codes"]]) {
    assert.equal((await call(method, path, {})).status, 401, `${path} (signed out)`);
    assert.equal((await call(method, path, { cookie: customerCookie })).status, 401, `${path} (customer)`);
  }
});

test("with two-step login on, the password alone signs nobody in: only a short pass comes back", async () => {
  const admin = await makeUser({ role: "admin" });
  await enableTwoFactor(admin);

  const first = await adminLogin(admin.email, PASSWORD);
  assert.equal(first.status, 200);
  assert.equal(first.data.twoFactorRequired, true);
  assert.ok(first.data.challenge);
  assert.deepEqual(first.cookies, {}, "no session cookie, no refresh token");
  assert.equal(first.data.token, undefined);
  assert.equal(first.data.user, undefined);
  assert.equal(await RefreshToken.countDocuments({ user: admin._id, revoked: false, role: "admin" }), 1, "only the session used for setup");

  // The pass is not a login: it is refused as an access token, as a cookie and as a refresh token.
  assert.equal((await call("GET", "/api/admin/dashboard", { headers: { Authorization: `Bearer ${first.data.challenge}` } })).status, 401);
  assert.equal((await call("GET", "/api/admin/dashboard", { cookie: `nx_admin=${first.data.challenge}` })).status, 401);
  // And an access token is refused as a pass.
  const real = await adminLogin(admin.email, PASSWORD);
  assert.equal((await call("POST", "/api/admin/login/2fa", { body: { challenge: jwt.sign({ purpose: "2fa" }, config.jwtSecret, { subject: String(admin._id), audience: "nexthlon-admin", issuer: "nexthlon" }), code: "123456" } })).status, 401);
  assert.ok(real.data.challenge);

  // A wrong password never gets as far as a pass.
  assert.equal((await adminLogin(admin.email, "Wrong2024!")).status, 401);
});

test("the second step: a right code signs in once; the same code again is refused; the next one works", async () => {
  const admin = await makeUser({ role: "admin" });
  const { secret } = await enableTwoFactor(admin);

  const pass = (await adminLogin(admin.email, PASSWORD)).data.challenge;
  const wrong = await call("POST", "/api/admin/login/2fa", { body: { challenge: pass, code: wrongCode(secret) } });
  assert.equal(wrong.status, 401);
  assert.match(wrong.data.message, /That code is not right\. 4 tries left/);
  assert.deepEqual(wrong.cookies, {});
  assert.equal((await call("POST", "/api/admin/login/2fa", { body: { challenge: pass } })).status, 400, "a code is needed");
  assert.equal((await call("POST", "/api/admin/login/2fa", { body: { code: "123456" } })).status, 401, "so is the pass");

  // The code enabling 2FA already used this 30-second step, so the current code is a replay: take the next one.
  const next = codeFor(secret, 1);
  const ok = await call("POST", "/api/admin/login/2fa", { body: { challenge: pass, code: next } });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.user.role, "admin");
  assert.ok(ok.cookies.nx_admin && ok.cookies.nx_admin_refresh);
  assert.equal((await call("GET", "/api/admin/dashboard", { cookie: cookieOf(ok) })).status, 200);
  assert.ok((await User.findById(admin._id)).lastLoginAt);

  // A second sign-in with the same code is a replay.
  const pass2 = (await adminLogin(admin.email, PASSWORD)).data.challenge;
  const replay = await call("POST", "/api/admin/login/2fa", { body: { challenge: pass2, code: next } });
  assert.equal(replay.status, 401);
  assert.match(replay.data.message, /already used/);
  // Two sign-ins racing with the same code: only one gets in.
  const [a, b] = await Promise.all([(await adminLogin(admin.email, PASSWORD)).data.challenge, (await adminLogin(admin.email, PASSWORD)).data.challenge]
    .map(async passPromise => ({ challenge: await passPromise })))
    .then(passes => Promise.all(passes.map(({ challenge }) => call("POST", "/api/admin/login/2fa", { body: { challenge, code: codeFor(secret, -1) } }))));
  assert.ok([a.status, b.status].every(status => status === 401), "a step older than the last accepted one is never taken");
});

test("recovery codes sign in once each, and say how many are left", async () => {
  const admin = await makeUser({ role: "admin" });
  const { recoveryCodes } = await enableTwoFactor(admin);

  const pass = (await adminLogin(admin.email, PASSWORD)).data.challenge;
  const used = await call("POST", "/api/admin/login/2fa", { body: { challenge: pass, code: recoveryCodes[0].toUpperCase() } });
  assert.equal(used.status, 200);
  assert.match(used.data.message, /recovery code; 9 left/);
  assert.equal(await AuditLog.countDocuments({ action: "auth.2fa_recovery_used", actor: admin._id }), 1);

  const pass2 = (await adminLogin(admin.email, PASSWORD)).data.challenge;
  const again = await call("POST", "/api/admin/login/2fa", { body: { challenge: pass2, code: recoveryCodes[0] } });
  assert.equal(again.status, 401, "each recovery code works once");
  const other = await call("POST", "/api/admin/login/2fa", { body: { challenge: pass2, code: recoveryCodes[1].replace("-", "") } });
  assert.equal(other.status, 200, "the dash is optional");
  assert.equal((await twoFactor.status(admin._id)).recoveryCodesLeft, 8);
});

test("five wrong codes lock the account for 15 minutes, whatever address the guesses come from", async () => {
  const admin = await makeUser({ role: "admin" });
  const { secret } = await enableTwoFactor(admin);
  const bad = wrongCode(secret);

  let last;
  for (let i = 0; i < twoFactor.MAX_FAILURES; i += 1) {
    const pass = (await adminLogin(admin.email, PASSWORD)).data.challenge;
    last = await call("POST", "/api/admin/login/2fa", { body: { challenge: pass, code: bad } });
  }
  assert.equal(last.status, 429);
  assert.match(last.data.message, /locked for 15 more minutes/);
  assert.ok(await AuditLog.exists({ action: "auth.2fa_locked", actor: admin._id }));

  // Locked: even the right code is refused, from a different address.
  const pass = (await adminLogin(admin.email, PASSWORD)).data.challenge;
  const locked = await call("POST", "/api/admin/login/2fa", { body: { challenge: pass, code: codeFor(secret, 1) } });
  assert.equal(locked.status, 429);
  assert.deepEqual(locked.cookies, {});

  // After the lock ends it works again, and the counter starts again.
  await User.updateOne({ _id: admin._id }, { "twoFactor.lockedUntil": new Date(Date.now() - 1000) });
  const ok = await call("POST", "/api/admin/login/2fa", { body: { challenge: pass, code: codeFor(secret, 1) } });
  assert.equal(ok.status, 200);
  assert.equal((await User.findById(admin._id)).twoFactor.failedAttempts, 0);
});

test("a pass that is old, forged, or for an admin whose situation changed is refused", async () => {
  const admin = await makeUser({ role: "admin" });
  const { secret } = await enableTwoFactor(admin);
  const code = () => codeFor(secret, 1);

  const expired = jwt.sign({ purpose: "2fa", ver: 0 }, config.jwtSecret, { subject: String(admin._id), audience: "nexthlon-2fa", issuer: "nexthlon", expiresIn: -10 });
  const timedOut = await call("POST", "/api/admin/login/2fa", { body: { challenge: expired, code: code() } });
  assert.equal(timedOut.status, 401);
  assert.match(timedOut.data.message, /timed out/);
  const forged = jwt.sign({ purpose: "2fa", ver: 0 }, "some-other-secret-that-is-long-enough-for-hs256", { subject: String(admin._id), audience: "nexthlon-2fa", issuer: "nexthlon", expiresIn: 300 });
  assert.equal((await call("POST", "/api/admin/login/2fa", { body: { challenge: forged, code: code() } })).status, 401);
  assert.equal((await call("POST", "/api/admin/login/2fa", { body: { challenge: "garbage", code: code() } })).status, 401);

  // The password was changed after the pass was issued: it no longer counts.
  const pass = (await adminLogin(admin.email, PASSWORD)).data.challenge;
  await User.updateOne({ _id: admin._id }, { $inc: { tokenVersion: 1 } });
  assert.equal((await call("POST", "/api/admin/login/2fa", { body: { challenge: pass, code: code() } })).status, 401);
  await User.updateOne({ _id: admin._id }, { $inc: { tokenVersion: -1 } });

  // Blocked, or no longer an admin, in the meantime.
  const pass2 = (await adminLogin(admin.email, PASSWORD)).data.challenge;
  await User.updateOne({ _id: admin._id }, { isBlocked: true });
  assert.equal((await call("POST", "/api/admin/login/2fa", { body: { challenge: pass2, code: code() } })).status, 401);
  await User.updateOne({ _id: admin._id }, { isBlocked: false, role: "customer" });
  assert.equal((await call("POST", "/api/admin/login/2fa", { body: { challenge: pass2, code: code() } })).status, 401);
  await User.updateOne({ _id: admin._id }, { role: "admin" });
});

test("the code step is rate limited per address", async () => {
  const admin = await makeUser({ role: "admin" });
  const { secret } = await enableTwoFactor(admin);
  const pass = (await adminLogin(admin.email, PASSWORD)).data.challenge;
  const statuses = [];
  // Wrong codes from one address: 10 are allowed, then the address is paused (the account would lock sooner,
  // so use an unknown pass to keep the account out of it).
  for (let i = 0; i < 12; i += 1) statuses.push((await call("POST", "/api/admin/login/2fa", { body: { challenge: pass + "x", code: wrongCode(secret) }, ip: "198.51.100.77" })).status);
  assert.deepEqual(statuses.slice(0, 10).every(status => status === 401), true);
  assert.deepEqual(statuses.slice(10), [429, 429]);
});

test("turning it off, and making new recovery codes, need the password AND a code", async () => {
  const admin = await makeUser({ role: "admin" });
  const { cookie, secret, recoveryCodes } = await enableTwoFactor(admin);

  assert.equal((await call("POST", "/api/admin/2fa/disable", { cookie, body: { code: codeFor(secret, 1) } })).status, 400, "no password");
  assert.equal((await call("POST", "/api/admin/2fa/disable", { cookie, body: { password: PASSWORD } })).status, 400, "no code");
  assert.equal((await call("POST", "/api/admin/2fa/disable", { cookie, body: { password: "Wrong2024!", code: codeFor(secret, 1) } })).status, 400);
  assert.equal((await call("POST", "/api/admin/2fa/disable", { cookie, body: { password: PASSWORD, code: wrongCode(secret) } })).status, 400);
  assert.equal((await twoFactor.status(admin._id)).enabled, true, "still on");

  // New recovery codes: the old ones stop working.
  const fresh = await call("POST", "/api/admin/2fa/recovery-codes", { cookie, body: { password: PASSWORD, code: codeFor(secret, 1) } });
  assert.equal(fresh.status, 200);
  assert.equal(fresh.data.recoveryCodes.length, 10);
  assert.ok(fresh.data.recoveryCodes.every(code => !recoveryCodes.includes(code)));
  const pass = (await adminLogin(admin.email, PASSWORD)).data.challenge;
  assert.equal((await call("POST", "/api/admin/login/2fa", { body: { challenge: pass, code: recoveryCodes[0] } })).status, 401, "an old recovery code");
  assert.equal((await call("POST", "/api/admin/login/2fa", { body: { challenge: pass, code: fresh.data.recoveryCodes[0] } })).status, 200, "a new one");

  // Off: a recovery code counts as the code. Sign-in is the password alone again.
  const off = await call("POST", "/api/admin/2fa/disable", { cookie, body: { password: PASSWORD, code: fresh.data.recoveryCodes[1] } });
  assert.equal(off.status, 200);
  const after = await adminLogin(admin.email, PASSWORD);
  assert.equal(after.status, 200);
  assert.equal(after.data.twoFactorRequired, undefined);
  assert.ok(after.cookies.nx_admin);
  const stored = await User.findById(admin._id).select("+twoFactor.secretEnc +twoFactor.recoveryHashes");
  assert.equal(stored.twoFactor.secretEnc, "");
  assert.deepEqual(stored.twoFactor.recoveryHashes, []);
  assert.ok(await AuditLog.exists({ action: "auth.2fa_disabled", actor: admin._id }));
});

test("the command-line reset turns two-step login off for a locked-out admin", async () => {
  const admin = await makeUser({ role: "admin" });
  await enableTwoFactor(admin);
  assert.equal(await twoFactor.resetByEmail("nobody@recovery.test"), false);
  assert.equal(await twoFactor.resetByEmail(admin.email.toUpperCase()), true);
  assert.equal((await adminLogin(admin.email, PASSWORD)).data.twoFactorRequired, undefined);
  // It only ever touches admins.
  const customer = await makeUser();
  assert.equal(await twoFactor.resetByEmail(customer.email), false);
});

test("a changed JWT_SECRET makes stored secrets unreadable, and signing in says so instead of crashing", async () => {
  const admin = await makeUser({ role: "admin" });
  await enableTwoFactor(admin);
  // A secret encrypted with a different key.
  const corrupted = twoFactor.encrypt("JBSWY3DPEHPK3PXP").replace(/\.[^.]+$/, ".AAAA");
  await User.updateOne({ _id: admin._id }, { "twoFactor.secretEnc": corrupted });
  const pass = (await adminLogin(admin.email, PASSWORD)).data.challenge;
  const reply = await call("POST", "/api/admin/login/2fa", { body: { challenge: pass, code: "123456" } });
  assert.equal(reply.status, 500);
  assert.match(reply.data.message, /Ask another admin to reset it/);
});

// =============================== The Security page, and making it required ===============================

test("the admin Security page shows the state, and ADMIN_REQUIRE_2FA keeps everything else shut until it is on", async () => {
  const admin = await makeUser({ role: "admin" });
  const cookie = cookieOf(await adminLogin(admin.email, PASSWORD));
  const page = await call("GET", "/admin/security", { cookie, headers: { Accept: "text/html" } });
  assert.equal(page.status, 200);
  assert.match(page.data, /Set up two-step login/);
  assert.match(page.data, /data-tf-chip>Off</);
  assert.match(page.data, /\/js\/admin-security\.js/);
  assert.match(page.data, /href="\/admin\/security"/, "in the sidebar");

  config.adminRequire2fa = true;
  try {
    const blocked = await call("GET", "/admin/dashboard", { cookie, headers: { Accept: "text/html" } });
    assert.equal(blocked.status, 302);
    assert.equal(blocked.location, "/admin/security?reason=required");
    assert.match((await call("GET", "/admin/security?reason=required", { cookie, headers: { Accept: "text/html" } })).data, /Two-step login is required for the console/);
    const api = await call("GET", "/api/admin/orders", { cookie });
    assert.equal(api.status, 403);
    assert.match(api.data.message, /Two-step login is required/);
    // The way out stays open.
    assert.equal((await call("GET", "/api/admin/2fa", { cookie })).status, 200);
    const setup = await call("POST", "/api/admin/2fa/setup", { cookie });
    assert.equal((await call("POST", "/api/admin/2fa/enable", { cookie, body: { code: codeFor(setup.data.secret.replace(/\s/g, "")) } })).status, 200);
    // On: the console opens.
    assert.equal((await call("GET", "/admin/dashboard", { cookie, headers: { Accept: "text/html" } })).status, 200);
    assert.equal((await call("GET", "/api/admin/orders", { cookie })).status, 200);
    const on = await call("GET", "/admin/security", { cookie, headers: { Accept: "text/html" } });
    assert.match(on.data, /data-tf-chip>On</);
    assert.match(on.data, /10 of 10/);
  } finally {
    config.adminRequire2fa = false;
  }
});
