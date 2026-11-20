// Order tools, finished: cash-on-delivery risk, order labels (tags), and batch printing.
require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const {codRisk} = require('../utils/codRisk');

// ---------- Rules that need no database ----------

test('COD risk: online payments are not scored; a risky cash order explains itself', () => {
  assert.equal(
    codRisk({paymentMethod: 'razorpay', total: 999999}).applies,
    false,
  );
  const low = codRisk({paymentMethod: 'cod', total: 50000, deliveredOrders: 5});
  assert.equal(low.level, 'low');
  assert.deepEqual(low.reasons, []);
  // High value (20) and no delivered order yet (25): medium.
  const medium = codRisk({
    paymentMethod: 'cod',
    total: 250000,
    deliveredOrders: 0,
  });
  assert.equal(medium.score, 45);
  assert.equal(medium.level, 'medium');
  // An earlier parcel came back (40) on top of the first-order point: high.
  const high = codRisk({
    paymentMethod: 'cod',
    total: 250000,
    deliveredOrders: 0,
    returnedOrders: 1,
  });
  assert.equal(high.level, 'high');
  assert.ok(high.reasons.some((r) => /came back/.test(r)));
  assert.ok(high.reasons.some((r) => /High value/.test(r)));
});

if (!process.env.TEST_MONGODB_URI) {
  test(
    'order finish tests (set TEST_MONGODB_URI to run them)',
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
dbUrl.pathname = `${dbUrl.pathname.replace(/\/$/, '')}_orderfinish`;

let server;
let base;
let adminCookie;
let customer;
let shoe;
let codOrder;
let onlineOrder;

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

function orderFor(id, paymentMethod, total, n) {
  return {
    orderId: `NX-2026-${String(920000 + n)}`,
    user: customer._id,
    items: [
      {
        product: shoe._id,
        name: shoe.name,
        slug: shoe.slug,
        price: total,
        mrp: total,
        quantity: 1,
        lineTotal: total,
        option: 'Size 9',
        sku: 'SHOE-9',
        status: 'confirmed',
      },
    ],
    address: {
      fullName: 'Print Test',
      phone: '9876543210',
      line1: '12 Test Road',
      city: 'Kochi',
      state: 'Kerala',
      pincode: '682001',
    },
    mrpTotal: total,
    subtotal: total,
    total,
    paymentMethod,
    paymentStatus: paymentMethod === 'cod' ? 'pending' : 'paid',
    orderStatus: 'confirmed',
    stockReserved: true,
    statusHistory: [],
    id,
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
    name: 'Finish Admin',
    email: 'admin@finish.test',
    passwordHash: await hashPassword('AdminPass123'),
    role: 'admin',
  });
  customer = await User.create({
    name: 'New Buyer',
    email: 'buyer@finish.test',
    passwordHash: await hashPassword('trail2024'),
    role: 'customer',
    createdAt: new Date(), // a brand-new account
  });
  const running = await categoryService.ensureCategory('Running');
  categoryService.invalidate();
  shoe = await Product.create({
    name: 'Finish Shoe',
    slug: 'finish-shoe',
    category: running._id,
    brand: 'Nexthlon',
    basePrice: 300000,
    mrp: 400000,
    stock: 20,
    image: '/img/favicon.svg',
  });
  codOrder = await Order.create(orderFor(null, 'cod', 250000, 1));
  onlineOrder = await Order.create(orderFor(null, 'razorpay', 250000, 2));
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  adminCookie = (
    await call('POST', '/api/admin/login', {
      body: {email: 'admin@finish.test', password: 'AdminPass123'},
    })
  ).cookie;
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  await new Promise((resolve) => server.close(resolve));
});

test('risk: the orders list scores cash orders from the customer history, and skips online ones', async () => {
  const list = await call('GET', '/api/admin/orders?status=all', {
    cookie: adminCookie,
  });
  assert.equal(list.status, 200);
  const cod = list.data.orders.find((o) => o.orderId === codOrder.orderId);
  const online = list.data.orders.find(
    (o) => o.orderId === onlineOrder.orderId,
  );
  assert.equal(cod.risk.applies, true);
  // High value, no delivered order yet, and a brand-new account: 20 + 25 + 15 = 60.
  assert.equal(cod.risk.score, 60);
  assert.equal(cod.risk.level, 'high');
  assert.equal(online.risk.applies, false);
});

test('labels: the fixed labels are saved and audited; anything else is refused', async () => {
  const saved = await call(
    'PATCH',
    `/api/admin/orders/${codOrder.orderId}/tags`,
    {
      cookie: adminCookie,
      body: {tags: ['gift', 'fragile']},
    },
  );
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.deepEqual((await Order.findById(codOrder._id).lean()).tags, [
    'gift',
    'fragile',
  ]);
  assert.ok(await AuditLog.findOne({action: 'order.tags_changed'}));

  const bad = await call(
    'PATCH',
    `/api/admin/orders/${codOrder.orderId}/tags`,
    {
      cookie: adminCookie,
      body: {tags: ['not-a-label']},
    },
  );
  assert.equal(bad.status, 400);
  assert.deepEqual((await Order.findById(codOrder._id).lean()).tags, [
    'gift',
    'fragile',
  ]);

  const cleared = await call(
    'PATCH',
    `/api/admin/orders/${codOrder.orderId}/tags`,
    {
      cookie: adminCookie,
      body: {tags: []},
    },
  );
  assert.equal(cleared.status, 200);
  assert.equal(cleared.data.message, 'Labels removed.');
});

test('order page: shows the risk and its reasons, and the labels form', async () => {
  const page = await call('GET', `/admin/orders/${codOrder.orderId}`, {
    cookie: adminCookie,
  });
  assert.equal(page.status, 200);
  assert.match(page.data, /Labels and risk/);
  assert.match(page.data, /high \(60\)/);
  assert.match(page.data, /First delivered order from this customer/);
  assert.match(page.data, /data-order-tags=/);
});

test('batch print: each chosen order gets its own page; junk ids and nothing chosen are handled', async () => {
  const two = await call(
    'GET',
    `/admin/orders/print?ids=${codOrder.orderId},${onlineOrder.orderId}`,
    {cookie: adminCookie},
  );
  assert.equal(two.status, 200);
  assert.equal((two.data.match(/class="print-order"/g) || []).length, 2);
  assert.match(two.data, /Ship to/);
  assert.match(two.data, /Size 9/);
  assert.match(two.data, /collect on delivery/);

  const none = await call('GET', '/admin/orders/print', {cookie: adminCookie});
  assert.equal(none.status, 200);
  assert.match(none.data, /No orders to print/);

  const junk = await call('GET', '/admin/orders/print?ids=%24where%2C1', {
    cookie: adminCookie,
  });
  assert.match(junk.data, /No orders to print/);
});
