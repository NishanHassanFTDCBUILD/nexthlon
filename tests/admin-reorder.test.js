// Inventory: reorder levels, and days of stock left at the recent sales pace.
require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const {daysOfCover} = require('../services/inventoryService');

test('days of cover: stock divided by the sales pace; no sales means no figure', () => {
  // 30 units sold in 30 days is one a day: 12 units left lasts 12 days.
  assert.equal(daysOfCover(12, 30), 12);
  assert.equal(daysOfCover(10, 15), 20);
  assert.equal(daysOfCover(5, 0), null);
});

if (!process.env.TEST_MONGODB_URI) {
  test(
    'reorder API tests (set TEST_MONGODB_URI to run them)',
    {skip: true},
    () => {},
  );
  return;
}

const mongoose = require('mongoose');
const app = require('../app');
const User = require('../models/User');
const Product = require('../models/Product');
const Order = require('../models/Order');
const AuditLog = require('../models/AuditLog');
const categoryService = require('../services/categoryService');
const {hashPassword} = require('../services/authService');

const dbUrl = new URL(process.env.TEST_MONGODB_URI);
dbUrl.pathname = `${dbUrl.pathname.replace(/\/$/, '')}_reorder`;

let server;
let base;
let adminCookie;
let shoe;
let socks;

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
  const admin = await User.create({
    name: 'Reorder Admin',
    email: 'admin@reorder.test',
    passwordHash: await hashPassword('AdminPass123'),
    role: 'admin',
  });
  const running = await categoryService.ensureCategory('Running');
  categoryService.invalidate();
  shoe = await Product.create({
    name: 'Reorder Shoe',
    slug: 'reorder-shoe',
    category: running._id,
    brand: 'Nexthlon',
    basePrice: 300000,
    mrp: 400000,
    stock: 6,
    image: '/img/favicon.svg',
  });
  socks = await Product.create({
    name: 'Reorder Socks',
    slug: 'reorder-socks',
    category: running._id,
    brand: 'Nexthlon',
    basePrice: 50000,
    mrp: 60000,
    stock: 40,
    image: '/img/favicon.svg',
  });
  // 30 pairs of shoes sold in the last 30 days (one delivered order), none cancelled.
  await Order.create({
    orderId: 'NX-2026-900001',
    user: admin._id,
    items: [
      {
        product: shoe._id,
        name: shoe.name,
        slug: shoe.slug,
        price: shoe.price,
        mrp: shoe.mrp,
        quantity: 30,
        lineTotal: shoe.price * 30,
        status: 'delivered',
      },
    ],
    address: {
      fullName: 'Reorder Admin',
      phone: '9876543210',
      line1: '1 Test Road',
      city: 'Kochi',
      state: 'Kerala',
      pincode: '682001',
    },
    mrpTotal: shoe.mrp * 30,
    subtotal: shoe.price * 30,
    total: shoe.price * 30,
    paymentMethod: 'cod',
    paymentStatus: 'paid',
    orderStatus: 'delivered',
    deliveredAt: new Date(),
    stockReserved: true,
    statusHistory: [],
  });
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  adminCookie = (
    await call('POST', '/api/admin/login', {
      body: {email: 'admin@reorder.test', password: 'AdminPass123'},
    })
  ).cookie;
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  await new Promise((resolve) => server.close(resolve));
});

test('reorder: a level is saved, flags the product when it is reached, and is audited', async () => {
  const set = await call('PATCH', `/api/admin/inventory/${shoe._id}/reorder`, {
    cookie: adminCookie,
    body: {reorderLevel: 8},
  });
  assert.equal(set.status, 200, JSON.stringify(set.data));
  assert.equal((await Product.findById(shoe._id).lean()).reorderLevel, 8);
  assert.ok(await AuditLog.findOne({action: 'inventory.reorder_changed'}));

  const list = await call('GET', '/api/admin/inventory?status=all', {
    cookie: adminCookie,
  });
  const row = list.data.products.find((p) => p.id === String(shoe._id));
  assert.equal(row.reorderLevel, 8);
  assert.equal(row.needsReorder, true, '6 units is at or below 8');
  assert.equal(row.soldLast30, 30);
  assert.equal(row.daysOfCover, 6, '6 units at 1 a day is 6 days');

  const other = list.data.products.find((p) => p.id === String(socks._id));
  assert.equal(other.reorderLevel, null);
  assert.equal(other.needsReorder, false);
  assert.equal(other.daysOfCover, null, 'no sales means no figure');
});

test('reorder: clearing the level returns to the store-wide level; bad values are refused', async () => {
  assert.equal(
    (
      await call('PATCH', `/api/admin/inventory/${shoe._id}/reorder`, {
        cookie: adminCookie,
        body: {reorderLevel: -3},
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await call('PATCH', `/api/admin/inventory/${shoe._id}/reorder`, {
        cookie: adminCookie,
        body: {reorderLevel: 'lots'},
      })
    ).status,
    400,
  );
  const cleared = await call(
    'PATCH',
    `/api/admin/inventory/${shoe._id}/reorder`,
    {
      cookie: adminCookie,
      body: {reorderLevel: null},
    },
  );
  assert.equal(cleared.status, 200);
  assert.equal((await Product.findById(shoe._id).lean()).reorderLevel, null);
});
