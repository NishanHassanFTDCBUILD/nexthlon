require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const tokens = require('../services/tokenService');
const config = require('../config/env');

const cookiesFrom = (response) =>
  response.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');

test('legacy owner login, real JWT cookies, expiry renewal and permission checks work together', async (t) => {
  const agent = 'Nexthlon login regression';
  const user = new User({
    _id: '0123456789abcdef01234567',
    name: 'Legacy owner',
    email: 'owner@example.test',
    role: 'admin',
    passwordHash: await bcrypt.hash('Valid-test-password-42', 4),
    adminDevices: [
      crypto.createHash('sha256').update(agent).digest('hex').slice(0, 16),
    ],
  });
  assert.equal(
    user.adminRole,
    '',
    'test the schema default used by seeded owner accounts',
  );
  user.save = async () => user;
  const query = () => {
    const q = {
      select: () => q,
      exec: async () => user,
      then: (resolve, reject) => Promise.resolve(user).then(resolve, reject),
    };
    return q;
  };
  t.mock.method(User, 'findOne', query);
  t.mock.method(User, 'findById', query);
  t.mock.method(
    require('../services/categoryService'),
    'listedCategories',
    async () => [],
  );
  t.mock.method(
    require('../services/accountService'),
    'recordLogin',
    async () => {},
  );
  const refresh = require('../services/refreshTokenService');
  t.mock.method(refresh, 'issue', async () => ({
    rawToken: 'test-admin-refresh',
    familyId: 'test-admin-family',
  }));
  t.mock.method(refresh, 'rotate', async (raw, options) => {
    assert.equal(raw, 'test-admin-refresh');
    assert.equal(options.role, 'admin');
    return {
      ok: true,
      user,
      rawToken: 'rotated-admin-refresh',
      familyId: 'test-admin-family',
    };
  });
  t.mock.method(
    require('../controllers/pageController'),
    'adminDashboard',
    (req, res) =>
      res.json({
        name: req.user.name,
        role: require('../utils/permissions').roleOf(req.user),
      }),
  );
  const app = require('../app');
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const send = (path, {cookie, body, method = 'GET'} = {}) =>
    fetch(base + path, {
      method,
      redirect: 'manual',
      headers: {
        'User-Agent': agent,
        ...(cookie ? {Cookie: cookie} : {}),
        ...(body ? {'Content-Type': 'application/json', Origin: base} : {}),
      },
      ...(body ? {body: JSON.stringify(body)} : {}),
    });
  assert.equal((await send('/admin/login')).status, 200);
  const rejected = await send('/api/admin/login', {
    method: 'POST',
    body: {email: user.email, password: 'wrong-password'},
  });
  assert.equal(rejected.status, 401);
  const login = await send('/api/admin/login', {
    method: 'POST',
    body: {email: user.email, password: 'Valid-test-password-42'},
  });
  assert.equal(login.status, 200, await login.clone().text());
  const body = await login.json();
  assert.equal(tokens.verifyToken(body.token, 'admin').sub, String(user._id));
  assert.throws(() => tokens.verifyToken(body.token, 'customer'));
  const session = cookiesFrom(login);
  assert.ok(session.includes('nx_admin='));
  assert.ok(session.includes('nx_admin_sid='));
  assert.ok(session.includes('nx_admin_refresh='));
  const accessCookie = login.headers
    .getSetCookie()
    .find((value) => value.startsWith('nx_admin='));
  assert.match(accessCookie, /HttpOnly/i);
  assert.match(accessCookie, /SameSite=Strict/i);
  const dashboard = await send('/admin/dashboard', {cookie: session});
  assert.equal(dashboard.status, 200, await dashboard.clone().text());
  assert.equal((await dashboard.json()).role, 'owner');
  const expired = jwt.sign({role: 'admin', ver: 0}, config.jwtSecret, {
    subject: String(user._id),
    issuer: 'nexthlon',
    audience: 'nexthlon-admin',
    algorithm: 'HS256',
    expiresIn: -1,
  });
  const expiredPage = await send('/admin/dashboard', {
    cookie: `nx_admin=${expired}; nx_admin_sid=test-admin-family`,
  });
  assert.equal(expiredPage.status, 302);
  assert.ok(expiredPage.headers.get('location').startsWith('/admin/login'));
  assert.equal(
    expiredPage.headers
      .getSetCookie()
      .some((value) => value.startsWith('nx_admin_refresh=')),
    false,
  );
  const renewed = await send('/api/auth/refresh', {
    method: 'POST',
    cookie: 'nx_admin_refresh=test-admin-refresh',
    body: {scope: 'admin'},
  });
  assert.equal(renewed.status, 200);
  assert.equal(
    (await send('/admin/dashboard', {cookie: cookiesFrom(renewed)})).status,
    200,
  );
  const customer = tokens.signToken({...user.toObject(), role: 'customer'});
  assert.equal(
    (await send('/admin/dashboard', {cookie: `nx_admin=${customer}`})).status,
    404,
  );
  user.tokenVersion = 1;
  assert.equal((await send('/admin/dashboard', {cookie: session})).status, 302);
  user.tokenVersion = 0;
  user.isBlocked = true;
  const blocked = await send('/admin/dashboard', {cookie: session});
  assert.equal(blocked.status, 302);
  assert.match(blocked.headers.get('location'), /blocked/);
  user.isBlocked = false;
  user.adminRole = 'owenr';
  assert.equal((await send('/admin/dashboard', {cookie: session})).status, 403);
});
