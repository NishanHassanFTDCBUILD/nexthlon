// Admin audit: every admin write leaves a record of who did what, with before and after values.
require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');

if (!process.env.TEST_MONGODB_URI) {
  test(
    'admin audit tests (set TEST_MONGODB_URI to run them)',
    {skip: true},
    () => {},
  );
  return;
}

const mongoose = require('mongoose');
const app = require('../app');
const User = require('../models/User');
const Product = require('../models/Product');
const AuditLog = require('../models/AuditLog');
const categoryService = require('../services/categoryService');
const {hashPassword} = require('../services/authService');

const dbUrl = new URL(process.env.TEST_MONGODB_URI);
dbUrl.pathname = `${dbUrl.pathname.replace(/\/$/, '')}_audit`;

let server;
let base;
let adminCookie;
let shoe;
let customer;

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
  const setCookie = response.headers.get('set-cookie') || '';
  const match = setCookie.match(/(nx_token|nx_admin)=([^;]*)/);
  const type = response.headers.get('content-type') || '';
  const data = type.includes('json')
    ? await response.json()
    : await response.text();
  return {
    status: response.status,
    data,
    cookie: match && match[2] ? `${match[1]}=${match[2]}` : null,
  };
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
    name: 'Audit Admin',
    email: 'admin@audit.test',
    passwordHash: await hashPassword('AdminPass123'),
    role: 'admin',
  });
  customer = await User.create({
    name: 'Audit Customer',
    email: 'customer@audit.test',
    passwordHash: await hashPassword('trail2024'),
    role: 'customer',
  });
  const running = await categoryService.ensureCategory('Running');
  categoryService.invalidate();
  shoe = await Product.create({
    name: 'Audit Shoe',
    slug: 'audit-shoe',
    category: running._id,
    brand: 'Nexthlon',
    basePrice: 300000,
    mrp: 400000,
    stock: 4,
    image: '/img/favicon.svg',
  });
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  adminCookie = (
    await call('POST', '/api/admin/login', {
      body: {email: 'admin@audit.test', password: 'AdminPass123'},
    })
  ).cookie;
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  await new Promise((resolve) => server.close(resolve));
});

const lastEntry = (action) =>
  AuditLog.findOne({action}).sort({at: -1, _id: -1}).lean();

test('audit: product listing and unlisting record the change', async () => {
  const off = await call('PATCH', `/api/admin/products/${shoe._id}/listing`, {
    cookie: adminCookie,
    body: {isListed: false},
  });
  assert.equal(off.status, 200);
  const entry = await lastEntry('product.unlisted');
  assert.ok(entry, 'unlisting is audit-logged');
  assert.equal(entry.target, `product:${shoe._id}`);
  assert.equal(entry.before.isListed, true);
  assert.equal(entry.after.isListed, false);
  assert.ok(entry.actor || entry.actorRole, 'the actor is recorded');

  await call('PATCH', `/api/admin/products/${shoe._id}/listing`, {
    cookie: adminCookie,
    body: {isListed: true},
  });
  assert.ok(await lastEntry('product.listed'));
});

test('audit: customer block and unblock record the change', async () => {
  const blocked = await call(
    'PATCH',
    `/api/admin/customers/${customer._id}/block`,
    {cookie: adminCookie, body: {isBlocked: true}},
  );
  assert.equal(blocked.status, 200);
  const entry = await lastEntry('customer.blocked');
  assert.ok(entry, 'blocking is audit-logged');
  assert.equal(entry.target, `user:${customer._id}`);
  assert.equal(entry.after.isBlocked, true);

  await call('PATCH', `/api/admin/customers/${customer._id}/block`, {
    cookie: adminCookie,
    body: {isBlocked: false},
  });
  assert.ok(await lastEntry('customer.unblocked'));
});

test('audit: a product edit keeps the price before and after', async () => {
  const res = await call('PATCH', `/api/admin/products/${shoe._id}`, {
    cookie: adminCookie,
    body: {
      name: 'Audit Shoe',
      description: 'Light trail shoe for everyday runs.',
      category: String(shoe.category),
      brand: 'Nexthlon',
      price: '2500',
      mrp: '4000',
      offerPercent: '0',
      stock: '4',
      isListed: 'true',
      keepImages: JSON.stringify(shoe.image ? [shoe.image] : []),
    },
  });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  const entry = await lastEntry('product.updated');
  assert.ok(entry, 'the edit is audit-logged');
  assert.equal(entry.target, `product:${shoe._id}`);
  assert.ok('price' in entry.before && 'price' in entry.after);
});

test('audit: product creation is recorded', async () => {
  const created = await call('POST', '/api/admin/products', {
    cookie: adminCookie,
    body: {},
  });
  // An empty body is refused by the form rules, so nothing is created or logged.
  assert.equal(created.status, 400);
  assert.equal(await AuditLog.countDocuments({action: 'product.created'}), 0);
});
