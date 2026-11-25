// Order tools: the shipping promise (late orders) and the pick list.
require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');

if (!process.env.TEST_MONGODB_URI) {
  test(
    'order tools tests (set TEST_MONGODB_URI to run them)',
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
const categoryService = require('../services/categoryService');
const adminOrderService = require('../services/adminOrderService');
const {SHIP_WITHIN_HOURS} = require('../utils/orderRules');
const {hashPassword} = require('../services/authService');

const dbUrl = new URL(process.env.TEST_MONGODB_URI);
dbUrl.pathname = `${dbUrl.pathname.replace(/\/$/, '')}_ordertools`;

let server;
let base;
let adminCookie;
let admin;
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

let seq = 0;
async function order({status, hoursAgo, items}) {
  seq += 1;
  const at = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
  return Order.create({
    orderId: `NX-2026-${String(910000 + seq)}`,
    user: admin._id,
    items: items.map(([product, quantity, option = '']) => ({
      product: product._id,
      name: product.name,
      slug: product.slug,
      price: product.price,
      mrp: product.mrp,
      quantity,
      lineTotal: product.price * quantity,
      option,
      status: 'confirmed',
    })),
    address: {
      fullName: 'Pick Test',
      phone: '9876543210',
      line1: '1 Test Road',
      city: 'Kochi',
      state: 'Kerala',
      pincode: '682001',
    },
    mrpTotal: 0,
    subtotal: 0,
    total: 0,
    paymentMethod: 'cod',
    paymentStatus: 'pending',
    orderStatus: status,
    stockReserved: true,
    statusHistory: [],
    createdAt: at,
    updatedAt: at,
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
  admin = await User.create({
    name: 'Pick Admin',
    email: 'admin@picks.test',
    passwordHash: await hashPassword('AdminPass123'),
    role: 'admin',
  });
  const running = await categoryService.ensureCategory('Running');
  categoryService.invalidate();
  shoe = await Product.create({
    name: 'Pick Shoe',
    slug: 'pick-shoe',
    category: running._id,
    brand: 'Nexthlon',
    basePrice: 300000,
    mrp: 400000,
    stock: 20,
    image: '/img/favicon.svg',
  });
  socks = await Product.create({
    name: 'Pick Socks',
    slug: 'pick-socks',
    category: running._id,
    brand: 'Nexthlon',
    basePrice: 50000,
    mrp: 60000,
    stock: 20,
    image: '/img/favicon.svg',
  });
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  adminCookie = (
    await call('POST', '/api/admin/login', {
      body: {email: 'admin@picks.test', password: 'AdminPass123'},
    })
  ).cookie;
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  await new Promise((resolve) => server.close(resolve));
});

test('late: an order not shipped within the promise is late; a fresh or shipped one is not', async () => {
  assert.equal(SHIP_WITHIN_HOURS, 24);
  const old = await order({
    status: 'confirmed',
    hoursAgo: SHIP_WITHIN_HOURS + 6,
    items: [[shoe, 1]],
  });
  const fresh = await order({
    status: 'confirmed',
    hoursAgo: 2,
    items: [[shoe, 1]],
  });
  const shipped = await order({
    status: 'shipped',
    hoursAgo: SHIP_WITHIN_HOURS + 6,
    items: [[shoe, 1]],
  });

  const rows = (await adminOrderService.listOrders({status: 'all'})).orders;
  const byId = new Map(rows.map((r) => [r.orderId, r]));
  assert.equal(byId.get(old.orderId).late, true);
  assert.equal(byId.get(fresh.orderId).late, false);
  assert.equal(
    byId.get(shipped.orderId).late,
    false,
    'shipped orders are not late',
  );
  assert.ok(byId.get(old.orderId).shipBy instanceof Date);

  const page = await call('GET', '/admin/orders?status=all', {
    cookie: adminCookie,
  });
  assert.equal(page.status, 200);
  assert.match(page.data, /Dispatch overdue/);
});

test('pick list: adds up units per product and size across the chosen orders, and prints', async () => {
  const a = await order({
    status: 'confirmed',
    hoursAgo: 3,
    items: [
      [shoe, 2, 'Size 9'],
      [socks, 1],
    ],
  });
  const b = await order({
    status: 'confirmed',
    hoursAgo: 4,
    items: [
      [shoe, 3, 'Size 9'],
      [shoe, 1, 'Size 10'],
    ],
  });
  const ids = `${a.orderId},${b.orderId}`;
  const res = await call('GET', `/admin/orders/pick-list?ids=${ids}`, {
    cookie: adminCookie,
  });
  assert.equal(res.status, 200);
  assert.match(res.data, /Pick list/);
  // Size 9 of the shoe: 2 + 3 = 5 units, one line, both orders named.
  assert.match(res.data, /Size 9/);
  assert.match(res.data, /<strong>5<\/strong>/);
  assert.match(res.data, new RegExp(a.orderId));
  assert.match(res.data, new RegExp(b.orderId));
  assert.match(res.data, /Size 10/);

  // With no ids, the pick list covers every order to ship (confirmed).
  const everything = await call('GET', '/admin/orders/pick-list', {
    cookie: adminCookie,
  });
  assert.equal(everything.status, 200);
  assert.match(everything.data, /every order to ship/);

  // A junk id is ignored, not used in a query.
  const junk = await call('GET', '/admin/orders/pick-list?ids=%24where%2C1', {
    cookie: adminCookie,
  });
  assert.equal(junk.status, 200);
});
