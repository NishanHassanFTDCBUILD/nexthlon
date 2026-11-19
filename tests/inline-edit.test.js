// Step 8: inline edit with undo (the category offer), audited and repricing the category's products.
require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');

if (!process.env.TEST_MONGODB_URI) {
  test(
    'inline edit tests (set TEST_MONGODB_URI to run them)',
    {skip: true},
    () => {},
  );
  return;
}

const mongoose = require('mongoose');
const app = require('../app');
const User = require('../models/User');
const Product = require('../models/Product');
const Category = require('../models/Category');
const AuditLog = require('../models/AuditLog');
const categoryService = require('../services/categoryService');
const {hashPassword} = require('../services/authService');

const dbUrl = new URL(process.env.TEST_MONGODB_URI);
dbUrl.pathname = `${dbUrl.pathname.replace(/\/$/, '')}_inline`;

let server;
let base;
let cookie;
let running;
let shoe;

async function call(method, path, {body} = {}) {
  const headers = {
    Accept: 'application/json,text/html',
    Origin: base,
    Cookie: cookie,
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
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
    name: 'Inline Admin',
    email: 'admin@inline.test',
    passwordHash: await hashPassword('AdminPass123'),
    role: 'admin',
  });
  running = await categoryService.ensureCategory('Running');
  categoryService.invalidate();
  shoe = await Product.create({
    name: 'Inline Shoe',
    slug: 'inline-shoe',
    category: running._id,
    brand: 'Nexthlon',
    basePrice: 100000,
    mrp: 120000,
    stock: 3,
    image: '/img/favicon.svg',
  });
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  const res = await fetch(`${base}/api/admin/login`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json', Origin: base},
    body: JSON.stringify({
      email: 'admin@inline.test',
      password: 'AdminPass123',
    }),
  });
  cookie = (res.headers.get('set-cookie') || '').match(/nx_admin=[^;]*/)[0];
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  await new Promise((resolve) => server.close(resolve));
});

test('inline offer: saving reprices the category products, and undo puts the old offer back', async () => {
  const saved = await call(
    'PATCH',
    `/api/admin/categories/${running._id}/offer`,
    {body: {offerPercent: 20}},
  );
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.equal((await Category.findById(running._id).lean()).offerPercent, 20);
  assert.equal(
    (await Product.findById(shoe._id).lean()).price,
    80000,
    '20% off the base price',
  );

  // The undo sends the previous value back.
  const undone = await call(
    'PATCH',
    `/api/admin/categories/${running._id}/offer`,
    {body: {offerPercent: 0}},
  );
  assert.equal(undone.status, 200);
  assert.equal((await Product.findById(shoe._id).lean()).price, 100000);

  const audits = await AuditLog.find({action: 'category.offer_changed'})
    .sort({_id: 1})
    .lean();
  assert.equal(
    audits.length,
    2,
    'both the change and the undo are audit-logged',
  );
  assert.equal(audits[0].before.offerPercent, 0);
  assert.equal(audits[0].after.offerPercent, 20);
});

test('inline offer: values outside 0 to 90 are refused, and the list shows the edit button', async () => {
  assert.equal(
    (
      await call('PATCH', `/api/admin/categories/${running._id}/offer`, {
        body: {offerPercent: 95},
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await call('PATCH', `/api/admin/categories/${running._id}/offer`, {
        body: {offerPercent: 'lots'},
      })
    ).status,
    400,
  );
  const page = await call('GET', '/admin/categories', {});
  assert.match(page.data, /data-inline-edit/);
  assert.match(page.data, /data-inline-cell/);
});
