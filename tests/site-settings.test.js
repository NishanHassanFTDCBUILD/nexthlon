// Store-wide settings an admin controls (services/siteSettingsService.js): delivery and returns,
// business details, catalogue limits, and shopper features (announcement bar, home sections,
// reviews, questions, back-in-stock alerts).
require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');

if (!process.env.TEST_MONGODB_URI) {
  test(
    'site settings tests (set TEST_MONGODB_URI to run them)',
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
const siteSettingsService = require('../services/siteSettingsService');
const {STORE} = require('../config/store');
const {RULES} = require('../config/catalog');
const {deliveryFeeFor} = require('../utils/pricing');
const {hashPassword} = require('../services/authService');

const dbUrl = new URL(process.env.TEST_MONGODB_URI);
dbUrl.pathname = `${dbUrl.pathname.replace(/\/$/, '')}_site`;

let server;
let base;
let adminCookie;
let shopperCookie;
let shoe;

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

const save = (group, body) =>
  call('PATCH', `/api/admin/settings/site/${group}`, {
    cookie: adminCookie,
    body,
  });

test.before(async () => {
  if (!/test/i.test(dbUrl.pathname))
    throw new Error("The test database must have 'test' in its name.");
  await mongoose.connect(dbUrl.href);
  await mongoose.connection.dropDatabase();
  await Promise.all(
    Object.values(mongoose.models).map((model) => model.syncIndexes()),
  );
  await siteSettingsService.reset();
  await User.create({
    name: 'Settings Admin',
    email: 'admin@site.test',
    passwordHash: await hashPassword('AdminPass123'),
    role: 'admin',
  });
  const running = await categoryService.ensureCategory('Running');
  categoryService.invalidate();
  shoe = await Product.create({
    name: 'Settings Shoe',
    slug: 'settings-shoe',
    category: running._id,
    brand: 'Nexthlon',
    basePrice: 300000,
    mrp: 400000,
    stock: 0,
    image: '/img/favicon.svg',
  });
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  adminCookie = (
    await call('POST', '/api/admin/login', {
      body: {email: 'admin@site.test', password: 'AdminPass123'},
    })
  ).cookie;
  shopperCookie = (
    await call('POST', '/api/signup', {
      body: {
        name: 'Kiran Rao',
        email: 'kiran@site.test',
        password: 'trail2024',
        confirmPassword: 'trail2024',
      },
    })
  ).cookie;
});

test.after(async () => {
  await siteSettingsService.reset();
  siteSettingsService.stop();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  await new Promise((resolve) => server.close(resolve));
});

test('site settings: admins only', async () => {
  assert.equal((await call('GET', '/api/admin/settings/site')).status, 401);
  assert.equal(
    (
      await call('PATCH', '/api/admin/settings/site/delivery', {
        cookie: shopperCookie,
        body: {deliveryFee: '10'},
      })
    ).status,
    401,
  );
  assert.equal((await save('nonsense', {})).status, 404);
  const page = await call('GET', '/admin/settings', {cookie: adminCookie});
  assert.equal(page.status, 200);
  for (const id of ['payments', 'business', 'delivery', 'shopper', 'home'])
    assert.match(page.data, new RegExp(`id="set-${id}"`));
});

test('delivery and returns: checkout charges and policy pages follow at once', async () => {
  const bad = await save('delivery', {deliveryFee: '5000', returnDays: '99'});
  assert.equal(bad.status, 400);
  assert.ok(bad.data.errors.deliveryFee);
  assert.ok(bad.data.errors.returnDays);

  const res = await save('delivery', {
    freeDeliveryMin: '999',
    deliveryFee: '60',
    returnDays: '10',
    dispatchDays: '1 working day',
  });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(STORE.freeDeliveryMin, 99900);
  assert.equal(STORE.deliveryFee, 6000);
  assert.equal(deliveryFeeFor(50000), 6000);
  assert.equal(deliveryFeeFor(99900), 0);
  const policy = await call('GET', '/refund-policy');
  assert.match(policy.data, /10 days/);
  const audit = await AuditLog.findOne({target: 'setting:site.delivery'});
  assert.equal(audit.after.deliveryFee, 6000);

  // Back to the defaults: nothing is stored for them.
  await save('delivery', {
    freeDeliveryMin: '499',
    deliveryFee: '40',
    returnDays: '7',
    dispatchDays: siteSettingsService.DEFAULTS.dispatchDays,
  });
  assert.equal(STORE.deliveryFee, 4000);
  assert.deepEqual(siteSettingsService.forAdmin().custom, []);
});

test('catalogue limits: the cart cap changes at once', async () => {
  const res = await save('catalog', {lowStockLimit: '8', maxPerProduct: '2'});
  assert.equal(res.status, 200);
  assert.equal(RULES.maxPerProduct, 2);
  assert.equal(RULES.lowStockLimit, 8);
  assert.equal((await save('catalog', {maxPerProduct: '0'})).status, 400);
  await save('catalog', {lowStockLimit: '5', maxPerProduct: '5'});
});

test('business details: empty means the default, and emails are checked', async () => {
  assert.equal((await save('business', {supportEmail: 'nope'})).status, 400);
  await save('business', {supportHours: 'Every day, 9 to 9'});
  assert.equal(STORE.supportHours, 'Every day, 9 to 9');
  await save('business', {supportHours: ''});
  assert.equal(STORE.supportHours, siteSettingsService.DEFAULTS.supportHours);
});

test('shopper features: announcement bar, reviews, questions and alerts', async () => {
  // A bar needs a message, and links must stay on this site.
  assert.equal((await save('shopper', {announceOn: true})).status, 400);
  assert.equal(
    (
      await save('shopper', {
        announceOn: true,
        announceText: 'Big sale',
        announceLink: 'https://evil.example',
      })
    ).status,
    400,
  );
  const on = await save('shopper', {
    announceOn: true,
    announceText: 'Monsoon sale: extra 10% off',
    announceLink: '/products',
    reviewsOn: false,
    questionsOn: false,
    stockAlertsOn: false,
  });
  assert.equal(on.status, 200, JSON.stringify(on.data));

  const home = await call('GET', '/');
  assert.match(home.data, /Monsoon sale: extra 10% off/);
  const product = await call('GET', `/products/${shoe.slug}`);
  assert.equal(product.status, 200);
  assert.doesNotMatch(product.data, /id="reviews"/);
  assert.doesNotMatch(product.data, /data-stock-alert/);

  const review = await call('POST', `/api/products/${shoe._id}/reviews`, {
    cookie: shopperCookie,
    body: {rating: 5, body: 'Great shoe for long runs.'},
  });
  assert.equal(review.status, 403);
  const question = await call('POST', `/api/products/${shoe._id}/questions`, {
    cookie: shopperCookie,
    body: {body: 'Is it good for wide feet?'},
  });
  assert.equal(question.status, 403);
  const alert = await call('POST', `/api/products/${shoe._id}/stock-alerts`, {
    body: {email: 'guest@site.test'},
  });
  assert.equal(alert.status, 403);

  await save('shopper', {
    announceOn: false,
    announceText: '',
    reviewsOn: true,
    questionsOn: true,
    stockAlertsOn: true,
  });
  const back = await call('GET', `/products/${shoe.slug}`);
  assert.match(back.data, /id="reviews"/);
  assert.doesNotMatch((await call('GET', '/')).data, /announce-bar/);
});

test('home page sections can be switched off', async () => {
  const off = await save('home', {
    ...Object.fromEntries(
      siteSettingsService.HOME_SECTIONS.map(([key]) => [key, true]),
    ),
    homeStats: false,
  });
  assert.equal(off.status, 200);
  assert.doesNotMatch((await call('GET', '/')).data, /Nexthlon in numbers/);
  await save(
    'home',
    Object.fromEntries(
      siteSettingsService.HOME_SECTIONS.map(([key]) => [key, true]),
    ),
  );
  assert.match((await call('GET', '/')).data, /Nexthlon in numbers/);
});
