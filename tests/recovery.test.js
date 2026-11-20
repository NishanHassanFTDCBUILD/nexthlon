// Forgot password and email confirmation, end to end against a real MongoDB
// test database. They only run when TEST_MONGODB_URI is set, and refuse any database whose name lacks "test".
require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');

if (!process.env.TEST_MONGODB_URI) {
  test(
    'recovery tests (set TEST_MONGODB_URI to run them)',
    {skip: true},
    () => {},
  );
  return;
}

const http = require('node:http');
const mongoose = require('mongoose');
const app = require('../app');
const config = require('../config/env');
const User = require('../models/User');
const AuthToken = require('../models/AuthToken');
const RefreshToken = require('../models/RefreshToken');
const AuditLog = require('../models/AuditLog');
const mailService = require('../services/mailService');
const authTokenService = require('../services/authTokenService');
const passwordResetService = require('../services/passwordResetService');
const {hashPassword} = require('../services/authService');
const {idle} = require('../utils/background');
const {renderEmail} = require('../utils/emailLayout');

const dbUrl = new URL(process.env.TEST_MONGODB_URI);
dbUrl.pathname = `${dbUrl.pathname.replace(/\/$/, '')}_recovery`;

let server;
let base;
let outbox;
let visitor = 0;

// Every call comes from its own pretend visitor address, so the rate limits (per address) do not
// get in the way of tests that are not about them. The tests that are about them fix the address.
app.set('trust proxy', 1);

async function call(method, path, {body, cookie, headers = {}, ip} = {}) {
  const requestHeaders = {
    Accept: 'application/json',
    Origin: base,
    'X-Forwarded-For':
      ip || `10.1.${Math.floor(visitor / 250)}.${(visitor += 1) % 250}`,
    ...headers,
  };
  if (body !== undefined) requestHeaders['Content-Type'] = 'application/json';
  if (cookie) requestHeaders.Cookie = cookie;
  const response = await fetch(base + path, {
    method,
    headers: requestHeaders,
    redirect: 'manual',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const type = response.headers.get('content-type') || '';
  const data = type.includes('json')
    ? await response.json()
    : await response.text();
  const cookies = Object.fromEntries(
    response.headers
      .getSetCookie()
      .map((line) => line.split(';')[0].split('='))
      .filter(([, value]) => value),
  );
  return {
    status: response.status,
    data,
    headers: response.headers,
    location: response.headers.get('location'),
    cookies,
  };
}

const cookieOf = (result) =>
  Object.entries(result.cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
const login = (email, password) =>
  call('POST', '/api/login', {body: {email, password}});
const adminLogin = (email, password) =>
  call('POST', '/api/admin/login', {body: {email, password}});
const tokenIn = (mail) => (mail.text.match(/token=([a-f0-9]{64})/) || [])[1];
const lastMail = () => outbox[outbox.length - 1];

const PASSWORD = 'Trail2024!';
const NEW_PASSWORD = 'Summit2025#';
let seq = 0;
async function makeUser(overrides = {}) {
  seq += 1;
  return User.create({
    name: `Person ${seq}`,
    email: `person${seq}@recovery.test`,
    passwordHash: await hashPassword(PASSWORD),
    role: 'customer',
    ...overrides,
  });
}

test.before(async () => {
  if (!/test/i.test(dbUrl.pathname))
    throw new Error("The test database must have 'test' in its name.");
  await mongoose.connect(dbUrl.href);
  await mongoose.connection.dropDatabase();
  await Promise.all(
    Object.values(mongoose.models).map((model) => model.syncIndexes()),
  );
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  outbox = [];
  mailService.useTestOutbox(outbox);
});

test.after(async () => {
  mailService.useTestOutbox(null);
  await idle();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  await new Promise((resolve) => server.close(resolve));
});

test.beforeEach(async () => {
  // Emails the previous test is still sending in the background land first, then the outbox is
  // emptied, so each test only sees its own emails.
  await idle();
  outbox.length = 0;
});

// =============================== Forgot password ===============================

test('asking for a reset sends one email with a one-time link, and the reply is the same for everyone', async () => {
  const known = await makeUser();
  const blocked = await makeUser({isBlocked: true});
  const deleted = await makeUser({isDeleted: true});
  const admin = await makeUser({role: 'admin'});

  const replies = [];
  for (const email of [
    known.email,
    'nobody@recovery.test',
    blocked.email,
    deleted.email,
    admin.email,
  ]) {
    const reply = await call('POST', '/api/password/forgot', {body: {email}});
    assert.equal(reply.status, 200, email);
    replies.push(JSON.stringify(reply.data));
  }
  assert.equal(
    new Set(replies).size,
    1,
    'identical reply: nothing says which addresses have accounts',
  );
  await idle();

  // Only the real, active customer got an email. Not an unknown address, not a blocked or deleted account,
  // and not an admin (an admin's password is changed from the command line).
  assert.equal(outbox.length, 1);
  const mail = outbox[0];
  assert.equal(mail.to, known.email);
  assert.match(mail.subject, /Reset your Nexthlon password/);
  assert.match(mail.text, /works once, for 30 minutes/);
  assert.match(
    mail.text,
    new RegExp(
      `${base.replace(/\./g, '\\.')}/reset-password\\?token=[a-f0-9]{64}`,
    ),
  );
  assert.match(mail.html, /Choose a new password/);

  // The row holds a hash, never the token itself, and it expires in 30 minutes.
  const raw = tokenIn(mail);
  const row = await AuthToken.findOne({
    user: known._id,
    purpose: 'password_reset',
  });
  assert.equal(row.tokenHash, authTokenService.hashToken(raw));
  assert.notEqual(row.tokenHash, raw);
  assert.ok(
    Math.abs(row.expiresAt.getTime() - Date.now() - 30 * 60 * 1000) < 5000,
  );
});

test('the request answers before any email work: bad input is refused, good input does not wait', async () => {
  assert.equal(
    (
      await call('POST', '/api/password/forgot', {
        body: {email: 'not-an-email'},
      })
    ).status,
    400,
  );
  assert.equal(
    (await call('POST', '/api/password/forgot', {body: {}})).status,
    400,
  );
  const user = await makeUser();
  const slowMail = [];
  mailService.useTestOutbox({
    push: (mail) => {
      slowMail.push(mail);
    },
  });
  try {
    const before = Date.now();
    const reply = await call('POST', '/api/password/forgot', {
      body: {email: user.email},
    });
    assert.equal(reply.status, 200);
    assert.ok(Date.now() - before < 2000);
    await idle();
    assert.equal(slowMail.length, 1);
  } finally {
    mailService.useTestOutbox(outbox);
  }
});

test('one account gets at most 3 reset emails an hour, however often it is asked', async () => {
  const user = await makeUser();
  for (let i = 0; i < 5; i += 1)
    await call('POST', '/api/password/forgot', {body: {email: user.email}});
  await idle();
  assert.equal(outbox.length, passwordResetService.MAX_PER_HOUR);
});

test('a new link replaces the older one: only the newest works', async () => {
  const user = await makeUser();
  await call('POST', '/api/password/forgot', {body: {email: user.email}});
  await idle();
  await call('POST', '/api/password/forgot', {body: {email: user.email}});
  await idle();
  const [older, newer] = outbox.map(tokenIn);
  assert.notEqual(older, newer);
  const stale = await call('POST', '/api/password/reset', {
    body: {token: older, password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD},
  });
  assert.equal(stale.status, 400);
  assert.match(stale.data.message, /expired or was already used/);
  assert.equal(
    (
      await call('POST', '/api/password/reset', {
        body: {
          token: newer,
          password: NEW_PASSWORD,
          confirmPassword: NEW_PASSWORD,
        },
      })
    ).status,
    200,
  );
});

test('the reset page: a good link shows the form, a bad one says it has expired, and the token stays private', async () => {
  const user = await makeUser();
  await call('POST', '/api/password/forgot', {body: {email: user.email}});
  await idle();
  const token = tokenIn(lastMail());

  const good = await call('GET', `/reset-password?token=${token}`, {
    headers: {Accept: 'text/html'},
  });
  assert.equal(good.status, 200);
  assert.match(good.data, /Choose a new password/);
  assert.match(good.data, new RegExp(`name="token" value="${token}"`));
  assert.equal(
    good.headers.get('referrer-policy'),
    'no-referrer',
    "the link's token is not sent to other sites",
  );
  assert.match(good.headers.get('cache-control'), /no-store/);
  // Opening the page does not use the link up.
  assert.equal(
    (
      await call('GET', `/reset-password?token=${token}`, {
        headers: {Accept: 'text/html'},
      })
    ).status,
    200,
  );
  assert.ok(await authTokenService.isUsable(token, 'password_reset'));

  for (const bad of ['', 'abc', 'z'.repeat(64), 'a'.repeat(64)]) {
    const page = await call('GET', `/reset-password?token=${bad}`, {
      headers: {Accept: 'text/html'},
    });
    assert.equal(page.status, 200);
    assert.match(page.data, /This link has expired/);
    assert.doesNotMatch(page.data, /name="password"/);
  }
});

test('choosing a new password: it works, the old one stops, every device is signed out, and the link is spent', async () => {
  const user = await makeUser();
  const phone = await login(user.email, PASSWORD);
  const laptop = await login(user.email, PASSWORD);
  assert.equal(
    (await call('GET', '/api/me', {cookie: cookieOf(phone)})).status,
    200,
  );

  await call('POST', '/api/password/forgot', {body: {email: user.email}});
  await idle();
  const token = tokenIn(lastMail());
  outbox.length = 0;

  const reset = await call('POST', '/api/password/reset', {
    body: {token, password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD},
  });
  assert.equal(reset.status, 200);
  assert.equal(reset.data.redirect, '/login?reason=password_reset');

  assert.equal(
    (await login(user.email, PASSWORD)).status,
    401,
    'the old password no longer works',
  );
  assert.equal((await login(user.email, NEW_PASSWORD)).status, 200);
  // Both signed-in devices are out: their access tokens (tokenVersion) and refresh tokens (revoked).
  assert.equal(
    (await call('GET', '/api/me', {cookie: cookieOf(phone)})).status,
    401,
  );
  assert.equal(
    (await call('GET', '/api/me', {cookie: cookieOf(laptop)})).status,
    401,
  );
  const old = await RefreshToken.find({
    user: user._id,
    revokedReason: 'password_reset',
  });
  assert.ok(old.length >= 2);

  // The link was one use.
  const again = await call('POST', '/api/password/reset', {
    body: {token, password: 'Another2026$', confirmPassword: 'Another2026$'},
  });
  assert.equal(again.status, 400);

  // The owner is told, the address counts as confirmed, and it is in the audit log (without the password).
  await idle();
  assert.equal(outbox.length, 1);
  assert.match(outbox[0].subject, /password was changed/i);
  assert.match(outbox[0].text, /signed out on every device/);
  assert.ok(
    (await User.findById(user._id)).emailVerifiedAt,
    'the link proved the inbox',
  );
  const audit = await AuditLog.findOne({
    action: 'auth.password_reset',
    actor: user._id,
  }).lean();
  assert.ok(audit);
  assert.doesNotMatch(JSON.stringify(audit), new RegExp(NEW_PASSWORD));
});

test('a weak or mismatched password is refused without spending the link', async () => {
  const user = await makeUser();
  await call('POST', '/api/password/forgot', {body: {email: user.email}});
  await idle();
  const token = tokenIn(lastMail());

  const weak = await call('POST', '/api/password/reset', {
    body: {token, password: 'short', confirmPassword: 'short'},
  });
  assert.equal(weak.status, 400);
  assert.ok(weak.data.errors.password);
  const mismatch = await call('POST', '/api/password/reset', {
    body: {token, password: NEW_PASSWORD, confirmPassword: 'Different2026!'},
  });
  assert.ok(mismatch.data.errors.confirmPassword);
  const noToken = await call('POST', '/api/password/reset', {
    body: {password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD},
  });
  assert.equal(noToken.status, 400);

  assert.ok(
    await authTokenService.isUsable(token, 'password_reset'),
    'still usable',
  );
  assert.equal(
    (
      await call('POST', '/api/password/reset', {
        body: {token, password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD},
      })
    ).status,
    200,
  );
});

test('an expired link does not work, and neither does one for an admin or a deleted account', async () => {
  const user = await makeUser();
  const raw = await authTokenService.issue(user, 'password_reset');
  await AuthToken.updateOne(
    {tokenHash: authTokenService.hashToken(raw)},
    {expiresAt: new Date(Date.now() - 1000)},
  );
  assert.equal(
    (
      await call('POST', '/api/password/reset', {
        body: {
          token: raw,
          password: NEW_PASSWORD,
          confirmPassword: NEW_PASSWORD,
        },
      })
    ).status,
    400,
  );

  // Tokens can only be made for the right accounts, but if one existed for an admin it must still be refused.
  const admin = await makeUser({role: 'admin'});
  const adminRaw = await authTokenService.issue(admin, 'password_reset');
  const refused = await call('POST', '/api/password/reset', {
    body: {
      token: adminRaw,
      password: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    },
  });
  assert.equal(refused.status, 400);
  assert.equal(
    (await adminLogin(admin.email, PASSWORD)).status,
    200,
    "the admin's password did not change",
  );

  const gone = await makeUser();
  const goneRaw = await authTokenService.issue(gone, 'password_reset');
  await User.updateOne({_id: gone._id}, {isDeleted: true});
  assert.equal(
    (
      await call('POST', '/api/password/reset', {
        body: {
          token: goneRaw,
          password: NEW_PASSWORD,
          confirmPassword: NEW_PASSWORD,
        },
      })
    ).status,
    400,
  );
});

test('two requests with the same link at the same instant: exactly one wins', async () => {
  const user = await makeUser();
  const raw = await authTokenService.issue(user, 'password_reset');
  const attempts = await Promise.all(
    ['Summit2025#', 'Summit2025$', 'Summit2025%', 'Summit2025^'].map(
      (password) =>
        call('POST', '/api/password/reset', {
          body: {token: raw, password, confirmPassword: password},
        }),
    ),
  );
  assert.equal(attempts.filter((reply) => reply.status === 200).length, 1);
  assert.equal(attempts.filter((reply) => reply.status === 400).length, 3);
});

test('asking for resets is rate limited per visitor address', async () => {
  const user = await makeUser();
  const statuses = [];
  for (let i = 0; i < 7; i += 1)
    statuses.push(
      (
        await call('POST', '/api/password/forgot', {
          body: {email: user.email},
          ip: '203.0.113.50',
        })
      ).status,
    );
  assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429, 429]);
});

// =============================== Confirming the email ===============================

test('signing up sends a confirmation link; opening the page uses nothing; confirming marks the address', async () => {
  const signup = await call('POST', '/api/signup', {
    body: {
      name: 'Meera Iyer',
      email: 'meera@recovery.test',
      password: PASSWORD,
      confirmPassword: PASSWORD,
    },
  });
  assert.equal(signup.status, 201);
  assert.equal(signup.data.user.emailVerified, false);
  await idle();
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].to, 'meera@recovery.test');
  assert.match(outbox[0].subject, /Confirm your email/);
  assert.match(outbox[0].text, /works for 48 hours|48 hours/);
  const token = tokenIn(outbox[0]);

  const page = await call('GET', `/verify-email?token=${token}`, {
    headers: {Accept: 'text/html'},
  });
  assert.match(page.data, /Confirm my email/);
  assert.equal(
    (await User.findOne({email: 'meera@recovery.test'})).emailVerifiedAt,
    null,
    'a page view (or a mail scanner) confirms nothing',
  );

  const confirmed = await call('POST', '/api/email/verify', {body: {token}});
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.data.user.emailVerified, true);
  assert.ok(
    (await User.findOne({email: 'meera@recovery.test'})).emailVerifiedAt,
  );
  assert.equal(
    (await call('POST', '/api/email/verify', {body: {token}})).status,
    400,
    'one use',
  );
  assert.match(
    (
      await call('GET', `/verify-email?token=${token}`, {
        headers: {Accept: 'text/html'},
      })
    ).data,
    /This link has expired/,
  );
  assert.equal(
    (await call('POST', '/api/email/verify', {body: {token: 'nope'}})).status,
    400,
  );
});

test('a signed-in customer with an unconfirmed email sees a reminder and can ask for the link again', async () => {
  const user = await makeUser();
  const session = await login(user.email, PASSWORD);
  const cookie = cookieOf(session);

  const account = await call('GET', '/account', {
    cookie,
    headers: {Accept: 'text/html'},
  });
  assert.match(account.data, /data-verify-banner/);
  assert.match(account.data, /Confirm your email/);

  const resend = await call('POST', '/api/account/email/resend', {cookie});
  assert.equal(resend.status, 200);
  assert.match(
    resend.data.message,
    new RegExp(user.email.replace(/\./g, '\\.')),
  );
  assert.equal(outbox.length, 1);
  const first = tokenIn(outbox[0]);
  // Asking again replaces the link: only the newest works.
  await call('POST', '/api/account/email/resend', {cookie});
  assert.equal(
    (await call('POST', '/api/email/verify', {body: {token: first}})).status,
    400,
  );
  const second = tokenIn(lastMail());
  assert.equal(
    (await call('POST', '/api/email/verify', {body: {token: second}})).status,
    200,
  );

  // Confirmed: the reminder is gone, and there is nothing to resend.
  assert.doesNotMatch(
    (await call('GET', '/account', {cookie, headers: {Accept: 'text/html'}}))
      .data,
    /data-verify-banner/,
  );
  assert.equal(
    (await call('POST', '/api/account/email/resend', {cookie})).status,
    400,
  );
  assert.equal(
    (await call('POST', '/api/account/email/resend', {})).status,
    401,
    'signed-in customers only',
  );
});

test('at most 4 confirmation emails an hour per account', async () => {
  const user = await makeUser();
  const cookie = cookieOf(await login(user.email, PASSWORD));
  const statuses = [];
  for (let i = 0; i < 6; i += 1)
    statuses.push(
      (await call('POST', '/api/account/email/resend', {cookie})).status,
    );
  assert.deepEqual(statuses, [200, 200, 200, 200, 429, 429]);
  assert.equal(outbox.length, 4);
});

test('changing the email needs the new address confirmed, and an old link cannot confirm it', async () => {
  const user = await makeUser();
  const cookie = cookieOf(await login(user.email, PASSWORD));
  await call('POST', '/api/account/email/resend', {cookie});
  const oldLink = tokenIn(lastMail());
  assert.equal(
    (await call('POST', '/api/email/verify', {body: {token: oldLink}})).status,
    200,
  );
  assert.ok((await User.findById(user._id)).emailVerifiedAt);

  outbox.length = 0;
  const changed = await call('PATCH', '/api/account/email', {
    cookie,
    body: {email: 'new-address@recovery.test', password: PASSWORD},
  });
  assert.equal(changed.status, 200, JSON.stringify(changed.data));
  assert.equal(changed.data.user.emailVerified, false);
  await idle();
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].to, 'new-address@recovery.test');

  // A confirmation link made for the earlier address is refused for the new one.
  // (Written straight into the collection: issuing a link would replace the newest one.)
  const staleRaw = authTokenService.newToken();
  await AuthToken.create({
    user: user._id,
    purpose: 'email_verify',
    tokenHash: authTokenService.hashToken(staleRaw),
    sentTo: user.email,
    expiresAt: new Date(Date.now() + 3600_000),
    deleteAt: new Date(Date.now() + 7200_000),
  });
  const stale = await call('POST', '/api/email/verify', {
    body: {token: staleRaw},
  });
  assert.equal(stale.status, 400);
  assert.match(stale.data.message, /earlier email address/);
  assert.equal(
    (
      await call('POST', '/api/email/verify', {
        body: {token: tokenIn(outbox[0])},
      })
    ).status,
    200,
  );
});

test('a password changed from the account sends the owner a notice', async () => {
  const user = await makeUser();
  const cookie = cookieOf(await login(user.email, PASSWORD));
  const reply = await call('PATCH', '/api/profile/password', {
    cookie,
    body: {
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
    },
  });
  assert.equal(reply.status, 200);
  await idle();
  assert.ok(
    outbox.some(
      (mail) =>
        mail.to === user.email && /password was changed/i.test(mail.subject),
    ),
  );
});

// =============================== The links in emails ===============================

test("links use SITE_URL when it is set, never the request's Host header", async () => {
  const user = await makeUser();
  const saved = config.siteUrl;
  config.siteUrl = 'https://shop.example.in';
  try {
    // A forged Host header (and a matching Origin, so the request gets past the cross-site check).
    await new Promise((resolve, reject) => {
      const body = JSON.stringify({email: user.email});
      const request = http.request(
        base + '/api/password/forgot',
        {
          method: 'POST',
          headers: {
            Host: 'evil.example',
            Origin: 'http://evil.example',
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
            'X-Forwarded-For': '10.9.9.9',
          },
        },
        (response) => {
          response.resume();
          response.on('end', resolve);
        },
      );
      request.on('error', reject);
      request.end(body);
    });
    await idle();
    assert.match(
      lastMail().text,
      /https:\/\/shop\.example\.in\/reset-password\?token=/,
    );
    assert.doesNotMatch(lastMail().text, /evil\.example/);
  } finally {
    config.siteUrl = saved;
  }
});

test('emails escape what they are given, and always have a plain-text version', () => {
  const {html, text} = renderEmail({
    preheader: 'x',
    heading: 'Hi <b>there</b>',
    paragraphs: ['A "quoted" <script>alert(1)</script> line'],
    button: {label: 'Go', url: 'https://shop.example/a?b=1&c=2'},
  });
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /href="https:\/\/shop\.example\/a\?b=1&amp;c=2"/);
  assert.match(text, /https:\/\/shop\.example\/a\?b=1&c=2/);
  assert.match(html, /lang="en"/);
});
