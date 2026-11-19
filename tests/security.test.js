// Security review (D3): the protections added before going live. Own database ("_security"); runs only
// when TEST_MONGODB_URI is set (the settings rule runs always).
require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');

if (!process.env.TEST_MONGODB_URI) {
  test(
    'security database tests (set TEST_MONGODB_URI to run them)',
    {skip: true},
    () => {},
  );
  return;
}

const mongoose = require('mongoose');
const app = require('../app');
const Product = require('../models/Product');
const Order = require('../models/Order');
const User = require('../models/User');
const Wallet = require('../models/Wallet');
const categoryService = require('../services/categoryService');
const settingsService = require('../services/settingsService');
const orderService = require('../services/orderService');
const {MAX_OPEN_COD} = require('../services/checkoutService');

const dbUrl = new URL(process.env.TEST_MONGODB_URI);
dbUrl.pathname = `${dbUrl.pathname.replace(/\/$/, '')}_security`;

let server;
let base;
let ball;

function jar() {
  const cookies = new Map();
  return {
    header: () =>
      [...cookies].map(([name, value]) => `${name}=${value}`).join('; '),
    take(response) {
      const all =
        typeof response.headers.getSetCookie === 'function'
          ? response.headers.getSetCookie()
          : [];
      all.forEach((line) => {
        const [pair, ...attrs] = line.split(';');
        const at = pair.indexOf('=');
        const name = pair.slice(0, at).trim();
        const value = pair.slice(at + 1).trim();
        if (
          attrs.some((a) => /expires=thu, 01 jan 1970/i.test(a)) ||
          value === ''
        )
          cookies.delete(name);
        else cookies.set(name, value);
      });
    },
  };
}

async function call(cookies, method, path, body) {
  const headers = {Accept: 'application/json', Origin: base};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const cookie = cookies.header();
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(base + path, {
    method,
    headers,
    redirect: 'manual',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  cookies.take(response);
  const type = response.headers.get('content-type') || '';
  return {
    status: response.status,
    data: type.includes('json') ? await response.json() : await response.text(),
  };
}

async function signUp(name, email, extra = {}) {
  const browser = jar();
  const res = await call(browser, 'POST', '/api/signup', {
    name,
    email,
    password: 'secure2024run',
    confirmPassword: 'secure2024run',
    ...extra,
  });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  return {browser, data: res.data, user: await User.findOne({email})};
}

const balanceOf = async (userId) =>
  ((await Wallet.findOne({user: userId}).lean()) || {balance: 0}).balance;

test.before(async () => {
  if (!/test/i.test(dbUrl.pathname))
    throw new Error("The security test database must have 'test' in its name.");
  await mongoose.connect(dbUrl.href);
  await mongoose.connection.dropDatabase();
  await Promise.all(
    Object.values(mongoose.models).map((model) => model.syncIndexes()),
  );
  const football = await categoryService.ensureCategory('Football');
  categoryService.invalidate();
  ball = await Product.create({
    name: 'Security Match Ball',
    slug: 'security-match-ball',
    category: football._id,
    brand: 'Nexthlon',
    basePrice: 59900,
    mrp: 69900,
    stock: 50,
    image: '/img/favicon.svg',
  });
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  await new Promise((resolve) => server.close(resolve));
});

test('security: one account can only take 10 wrong passwords in 15 minutes, wherever they come from', async () => {
  await signUp('Lock Target', 'lock.target@security.test');
  const attacker = jar();
  for (let i = 0; i < 10; i += 1) {
    const wrong = await call(attacker, 'POST', '/api/login', {
      email: 'Lock.Target@security.test ',
      password: `guess-${i}`,
    });
    assert.equal(wrong.status, 401, `attempt ${i + 1}`);
  }
  const blocked = await call(jar(), 'POST', '/api/login', {
    email: 'lock.target@security.test',
    password: 'secure2024run',
  });
  assert.equal(
    blocked.status,
    429,
    'even the right password waits once the account is under attack',
  );
  assert.match(
    blocked.data.message,
    /Too many sign-in attempts for this account/,
  );
  // Another account is not affected.
  await signUp('Other Person', 'other.person@security.test');
  const other = await call(jar(), 'POST', '/api/login', {
    email: 'other.person@security.test',
    password: 'secure2024run',
  });
  assert.equal(other.status, 200);
});

test('security: at most 3 unpaid Cash on Delivery orders on the way per customer', async () => {
  assert.equal(MAX_OPEN_COD, 3);
  const {browser} = await signUp('Cod Buyer', 'cod.buyer@security.test');
  const address = await call(browser, 'POST', '/api/addresses', {
    fullName: 'Cod Buyer',
    phone: '9876543210',
    line1: '12 MG Road',
    city: 'Kochi',
    state: 'Kerala',
    pincode: '682001',
  });
  const addressId =
    (address.data.address || address.data.addresses[0]).id ||
    (address.data.address || address.data.addresses[0])._id;
  const place = async () => {
    await call(browser, 'POST', '/api/cart/items', {
      productId: String(ball._id),
      quantity: 1,
    });
    return call(browser, 'POST', '/api/orders', {
      addressId,
      paymentMethod: 'cod',
    });
  };
  for (let i = 0; i < 3; i += 1) assert.equal((await place()).status, 201);
  const fourth = await place();
  assert.equal(fourth.status, 400);
  assert.equal(fourth.data.code, 'cod_open_limit');

  // Once one arrives (delivered and paid), the next can be placed.
  const first = await Order.findOne({
    user: (await User.findOne({email: 'cod.buyer@security.test'}))._id,
  }).sort({createdAt: 1});
  for (const status of [
    'confirmed',
    'shipped',
    'out_for_delivery',
    'delivered',
  ])
    await orderService.advanceStatus(first, status);
  assert.equal((await place()).status, 201);
});

test('security: a referral pays nothing at sign-up, and both people once the first order is delivered', async () => {
  await settingsService.set('referralReward', 10000); // ₹100, in paise
  const inviter = await signUp('Invite Er', 'inviter@security.test');
  const code = inviter.user.referralCode;
  const friend = await signUp('Fri End', 'friend@security.test', {
    referralCode: code,
  });
  assert.match(friend.data.message, /when your first order is delivered/);
  assert.equal(await balanceOf(friend.user._id), 0);
  assert.equal(
    await balanceOf(inviter.user._id),
    0,
    'a made-up account earns the inviter nothing',
  );

  const address = await call(friend.browser, 'POST', '/api/addresses', {
    fullName: 'Fri End',
    phone: '9876543210',
    line1: '12 MG Road',
    city: 'Kochi',
    state: 'Kerala',
    pincode: '682001',
  });
  const addressId =
    (address.data.address || address.data.addresses[0]).id ||
    (address.data.address || address.data.addresses[0])._id;
  await call(friend.browser, 'POST', '/api/cart/items', {
    productId: String(ball._id),
    quantity: 1,
  });
  const placed = await call(friend.browser, 'POST', '/api/orders', {
    addressId,
    paymentMethod: 'cod',
  });
  assert.equal(placed.status, 201, JSON.stringify(placed.data));
  const order = await Order.findOne({orderId: placed.data.order.orderId});
  for (const status of ['confirmed', 'shipped', 'out_for_delivery'])
    await orderService.advanceStatus(order, status);
  assert.equal(await balanceOf(friend.user._id), 0, 'not before delivery');
  await orderService.advanceStatus(order, 'delivered');
  assert.equal(await balanceOf(friend.user._id), 10000);
  assert.equal(await balanceOf(inviter.user._id), 10000);
});

test('security: a backup restores into a new database exactly, and never over one with data', async () => {
  const os = require('os');
  const path = require('path');
  const fs = require('fs');
  const {backup, restore} = require('../scripts/backup');
  const {EJSON} = mongoose.mongo.BSON;
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'nx-backup-'));
  const target = `${mongoose.connection.db.databaseName}_restored`;
  const uri = dbUrl.href;
  // The script opens its own connection; the test's own connection is put back afterwards.
  await mongoose.disconnect();
  try {
    const summary = await backup(uri, folder);
    assert.ok(summary.collections.users > 0);
    const {expected, restored} = await restore(uri, folder, target);
    assert.deepEqual(restored, expected);
    await assert.rejects(restore(uri, folder, target), /already has/);
  } finally {
    await mongoose.connect(uri);
  }
  const copy = mongoose.connection.useDb(target, {useCache: false}).db;
  const original = await mongoose.connection.db
    .collection('orders')
    .find()
    .sort({_id: 1})
    .toArray();
  const back = await copy.collection('orders').find().sort({_id: 1}).toArray();
  assert.equal(
    EJSON.stringify(back, {relaxed: false}),
    EJSON.stringify(original, {relaxed: false}),
    'ids, dates and money exactly the same',
  );
  await copy.dropDatabase();
  fs.rmSync(folder, {recursive: true, force: true});
});
