// Step 8: saved list views (per admin), and the console tools loaded on every page.
require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');

if (!process.env.TEST_MONGODB_URI) {
  test(
    'admin tools tests (set TEST_MONGODB_URI to run them)',
    {skip: true},
    () => {},
  );
  return;
}

const mongoose = require('mongoose');
const app = require('../app');
const User = require('../models/User');
const AdminView = require('../models/AdminView');
const {hashPassword} = require('../services/authService');

const dbUrl = new URL(process.env.TEST_MONGODB_URI);
dbUrl.pathname = `${dbUrl.pathname.replace(/\/$/, '')}_tools`;

let server;
let base;
let ownerCookie;
let otherCookie;

async function call(method, path, {body, cookie} = {}) {
  const headers = {Accept: 'application/json,text/html', Origin: base};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(base + path, {
    method,
    headers,
    redirect: 'manual',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const type = response.headers.get('content-type') || '';
  const data = type.includes('json')
    ? await response.json()
    : await response.text();
  return {status: response.status, data};
}

test.before(async () => {
  if (!/test/i.test(dbUrl.pathname))
    throw new Error("The test database must have 'test' in its name.");
  await mongoose.connect(dbUrl.href);
  await mongoose.connection.dropDatabase();
  await Promise.all(
    Object.values(mongoose.models).map((model) => model.syncIndexes()),
  );
  await User.create({
    name: 'Tools Owner',
    email: 'owner@tools.test',
    passwordHash: await hashPassword('AdminPass123'),
    role: 'admin',
  });
  await User.create({
    name: 'Tools Packing',
    email: 'packing@tools.test',
    passwordHash: await hashPassword('AdminPass123'),
    role: 'admin',
    adminRole: 'packing',
  });
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  const login = async (email) => {
    const res = await fetch(`${base}/api/admin/login`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json', Origin: base},
      body: JSON.stringify({email, password: 'AdminPass123'}),
    });
    return (res.headers.get('set-cookie') || '').match(/nx_admin=[^;]*/)[0];
  };
  ownerCookie = await login('owner@tools.test');
  otherCookie = await login('packing@tools.test');
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  await new Promise((resolve) => server.close(resolve));
});

test('saved views: each admin keeps their own named filters for a list, and can remove them', async () => {
  const made = await call('POST', '/api/admin/views', {
    cookie: ownerCookie,
    body: {
      path: '/admin/orders',
      name: 'COD to ship',
      query: '?method=cod&status=confirmed',
    },
  });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  assert.equal(made.data.view.query, 'method=cod&status=confirmed');

  const mine = await call('GET', '/api/admin/views?path=/admin/orders', {
    cookie: ownerCookie,
  });
  assert.equal(mine.data.views.length, 1);
  assert.equal(mine.data.views[0].name, 'COD to ship');

  // Another admin does not see it.
  const theirs = await call('GET', '/api/admin/views?path=/admin/orders', {
    cookie: otherCookie,
  });
  assert.equal(theirs.data.views.length, 0);

  // They cannot remove it either.
  const id = mine.data.views[0].id;
  assert.equal(
    (await call('DELETE', `/api/admin/views/${id}`, {cookie: otherCookie}))
      .status,
    404,
  );
  assert.equal(
    (await call('DELETE', `/api/admin/views/${id}`, {cookie: ownerCookie}))
      .status,
    200,
  );
  assert.equal(await AdminView.countDocuments({}), 0);
});

test('saved views: names are checked, the list must be a console page, and there is a limit per list', async () => {
  assert.equal(
    (
      await call('POST', '/api/admin/views', {
        cookie: ownerCookie,
        body: {path: '/admin/orders', name: 'x', query: ''},
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await call('POST', '/api/admin/views', {
        cookie: ownerCookie,
        body: {path: 'https://evil.example', name: 'Bad', query: ''},
      })
    ).status,
    400,
  );
  for (let n = 0; n < 12; n += 1)
    await call('POST', '/api/admin/views', {
      cookie: ownerCookie,
      body: {path: '/admin/products', name: `View ${n}`, query: `q=${n}`},
    });
  assert.equal(
    (
      await call('POST', '/api/admin/views', {
        cookie: ownerCookie,
        body: {path: '/admin/products', name: 'One too many', query: ''},
      })
    ).status,
    409,
  );
});

test('console tools: the shortcut sheet and the scripts load on the list pages', async () => {
  const page = await call('GET', '/admin/orders', {cookie: ownerCookie});
  assert.equal(page.status, 200);
  assert.match(page.data, /id="admin-help"/);
  assert.match(page.data, /Keyboard shortcuts/);
  assert.match(page.data, /admin-tools/);
});
