// Admin Category Management and Deals of the Day, plus the pricing rule that joins them:
// a shopper pays the best of the product offer, the category offer and a running deal.
require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const {priceFor, bestOfferFor} = require('../utils/pricing');
const {validateDeal, validateCategory} = require('../utils/validators');

// ---------- Rules that need no database ----------

test('pricing: a running deal joins the offers, and the best one wins', () => {
  const base = {basePrice: 100000, mrp: 120000};
  assert.deepEqual(
    bestOfferFor({offerPercent: 10, categoryOffer: 5, dealOffer: 25}),
    {percent: 25, source: 'deal'},
  );
  assert.equal(
    priceFor({...base, offerPercent: 10, dealOffer: 25}).price,
    75000,
  );
  // A smaller deal changes nothing: offers never add up.
  assert.equal(
    priceFor({...base, offerPercent: 30, dealOffer: 25}).price,
    70000,
  );
  // On a tie the product offer is named, so the label does not flicker.
  assert.equal(
    bestOfferFor({offerPercent: 20, dealOffer: 20}).source,
    'product',
  );
  assert.equal(priceFor({...base}).price, 100000);
});

test('validators: a deal needs a product, a percent and a sensible time window', () => {
  const ok = validateDeal({
    product: 'a'.repeat(24),
    percent: '15',
    startsAt: '2026-11-19T09:30',
    endsAt: '2026-11-20T09:30',
    isActive: true,
  });
  assert.deepEqual(ok.errors, {});
  // Times are Indian time.
  assert.equal(ok.value.startsAt.toISOString(), '2026-11-19T04:00:00.000Z');

  const bad = validateDeal({
    product: 'nope',
    percent: '95',
    startsAt: '2026-11-20T09:30',
    endsAt: '2026-11-19T09:30',
  });
  assert.ok(bad.errors.product);
  assert.ok(bad.errors.percent);
  assert.ok(bad.errors.endsAt);

  const long = validateDeal({
    product: 'a'.repeat(24),
    percent: '10',
    startsAt: '2026-11-01T00:00',
    endsAt: '2026-12-30T00:00',
  });
  assert.match(long.errors.endsAt, /31 days/);
});

test('validators: a category needs a name; the link name is cleaned', () => {
  const ok = validateCategory({
    name: '  Yoga  ',
    slug: 'Yoga & Pilates!',
    offerPercent: '12',
    isListed: 'true',
  });
  assert.deepEqual(ok.errors, {});
  assert.equal(ok.value.name, 'Yoga');
  assert.equal(ok.value.slug, 'yoga-pilates');
  assert.equal(ok.value.isListed, true);
  const bad = validateCategory({name: 'x', offerPercent: '99'});
  assert.ok(bad.errors.name);
  assert.ok(bad.errors.offerPercent);
});

// ---------- Through the API, with a database ----------

if (!process.env.TEST_MONGODB_URI) {
  test(
    'category and deal API tests (set TEST_MONGODB_URI to run them)',
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
const Deal = require('../models/Deal');
const AuditLog = require('../models/AuditLog');
const categoryService = require('../services/categoryService');
const dealService = require('../services/dealService');
const productService = require('../services/productService');
const {hashPassword} = require('../services/authService');

const dbUrl = new URL(process.env.TEST_MONGODB_URI);
dbUrl.pathname = `${dbUrl.pathname.replace(/\/$/, '')}_catdeals`;

let server;
let base;
let adminCookie;
let shopperCookie;
let running;
let shoe;
let bottle;

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

// "2026-11-19T09:30" in Indian time, some minutes from now.
const istInput = (minutesFromNow) =>
  new Date(Date.now() + minutesFromNow * 60000 + 330 * 60000)
    .toISOString()
    .slice(0, 16);

test.before(async () => {
  if (!/test/i.test(dbUrl.pathname))
    throw new Error("The test database must have 'test' in its name.");
  await mongoose.connect(dbUrl.href);
  await mongoose.connection.dropDatabase();
  await Promise.all(
    Object.values(mongoose.models).map((model) => model.syncIndexes()),
  );
  await User.create({
    name: 'Catalog Admin',
    email: 'admin@catdeals.test',
    passwordHash: await hashPassword('AdminPass123'),
    role: 'admin',
  });
  running = await categoryService.ensureCategory('Running');
  categoryService.invalidate();
  shoe = await Product.create({
    name: 'Deal Trail Shoe',
    slug: 'deal-trail-shoe',
    category: running._id,
    brand: 'Nexthlon',
    basePrice: 300000,
    mrp: 400000,
    offerPercent: 10,
    stock: 10,
    image: '/img/favicon.svg',
  });
  bottle = await Product.create({
    name: 'Deal Bottle',
    slug: 'deal-bottle',
    category: running._id,
    brand: 'Nexthlon',
    basePrice: 50000,
    mrp: 60000,
    stock: 5,
    image: '/img/favicon.svg',
  });
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  adminCookie = (
    await call('POST', '/api/admin/login', {
      body: {email: 'admin@catdeals.test', password: 'AdminPass123'},
    })
  ).cookie;
  shopperCookie = (
    await call('POST', '/api/signup', {
      body: {
        name: 'Meera Das',
        email: 'meera@catdeals.test',
        password: 'trail2024',
        confirmPassword: 'trail2024',
      },
    })
  ).cookie;
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  await new Promise((resolve) => server.close(resolve));
});

// ======================= Categories =======================

test('categories: only admins can use the API or see the pages', async () => {
  assert.equal((await call('GET', '/api/admin/categories')).status, 401);
  assert.equal(
    (await call('GET', '/api/admin/categories', {cookie: shopperCookie}))
      .status,
    401,
  );
  assert.equal((await call('GET', '/admin/categories')).status, 404);
  const page = await call('GET', '/admin/categories', {cookie: adminCookie});
  assert.equal(page.status, 200);
  assert.match(page.data, /Categories/);
  assert.match(page.data, /Running/);
});

test('categories: create, rename, offer reprices products, hide, show, delete', async () => {
  const created = await call('POST', '/api/admin/categories', {
    cookie: adminCookie,
    body: {name: 'Yoga', offerPercent: '5', sortOrder: '3', isListed: true},
  });
  assert.equal(created.status, 201);
  assert.equal(created.data.category.slug, 'yoga');
  const yogaId = created.data.category.id;

  // Names are unique whatever the letter case.
  const twin = await call('POST', '/api/admin/categories', {
    cookie: adminCookie,
    body: {name: 'YOGA', isListed: true},
  });
  assert.equal(twin.status, 409);
  assert.ok(twin.data.errors.name);

  // A bigger category offer reprices every product in it, at once.
  const offer = await call('PATCH', `/api/admin/categories/${running._id}`, {
    cookie: adminCookie,
    body: {name: 'Running', offerPercent: '20', sortOrder: '0', isListed: true},
  });
  assert.equal(offer.status, 200);
  const repriced = await Product.findById(shoe._id).lean();
  assert.equal(repriced.categoryOffer, 20);
  assert.equal(repriced.price, 240000); // 300000 less 20%, beating the 10% product offer

  // Hiding hides the products too; showing brings them back.
  const hide = await call(
    'PATCH',
    `/api/admin/categories/${running._id}/listing`,
    {cookie: adminCookie, body: {isListed: false}},
  );
  assert.equal(hide.status, 200);
  assert.equal((await Product.findById(shoe._id).lean()).categoryListed, false);
  await call('PATCH', `/api/admin/categories/${running._id}/listing`, {
    cookie: adminCookie,
    body: {isListed: true},
  });
  assert.equal((await Product.findById(shoe._id).lean()).categoryListed, true);

  // A category with products cannot be deleted; an empty one can.
  const refused = await call('DELETE', `/api/admin/categories/${running._id}`, {
    cookie: adminCookie,
  });
  assert.equal(refused.status, 409);
  const removed = await call('DELETE', `/api/admin/categories/${yogaId}`, {
    cookie: adminCookie,
  });
  assert.equal(removed.status, 200);
  assert.equal(await Category.exists({_id: yogaId}), null);

  const actions = await AuditLog.distinct('action', {
    action: /^category\./,
  });
  for (const action of [
    'category.created',
    'category.updated',
    'category.hidden',
    'category.shown',
    'category.deleted',
  ])
    assert.ok(actions.includes(action), action);

  // Back to no category offer for the deal tests below.
  await call('PATCH', `/api/admin/categories/${running._id}`, {
    cookie: adminCookie,
    body: {name: 'Running', offerPercent: '0', sortOrder: '0', isListed: true},
  });
});

test('categories: the list pages and filters', async () => {
  for (let n = 0; n < 22; n += 1)
    await Category.create({
      name: `Sport ${String(n).padStart(2, '0')}`,
      nameKey: `sport ${n}`,
      slug: `sport-${n}`,
      isListed: n % 2 === 0,
    });
  const first = await call('GET', '/api/admin/categories?sort=name', {
    cookie: adminCookie,
  });
  assert.equal(first.data.categories.length, 20);
  assert.equal(first.data.pagination.pages, 2);
  const second = await call('GET', '/api/admin/categories?sort=name&page=2', {
    cookie: adminCookie,
  });
  assert.equal(second.data.categories.length, 3);
  const hidden = await call('GET', '/api/admin/categories?status=hidden', {
    cookie: adminCookie,
  });
  assert.equal(hidden.data.pagination.total, 11);
  const page = await call('GET', '/admin/categories?page=2&sort=name', {
    cookie: adminCookie,
  });
  assert.match(page.data, /class="admin-pager"/);
  assert.match(
    page.data,
    /Showing <strong>21–23<\/strong> of <strong>23<\/strong>/,
  );
  // Rows per page: 50 fits every category on one page.
  const wide = await call('GET', '/api/admin/categories?limit=50', {
    cookie: adminCookie,
  });
  assert.equal(wide.data.categories.length, 23);
  assert.equal(wide.data.pagination.limit, 50);
  // Anything other than 20, 50 or 100 falls back to the usual size.
  const odd = await call('GET', '/api/admin/categories?limit=5000', {
    cookie: adminCookie,
  });
  assert.equal(odd.data.pagination.limit, 20);
  await Category.deleteMany({slug: /^sport-/});
});

// ======================= Deals of the Day =======================

test('deals: a live deal sets the price; turning it off puts the price back', async () => {
  const before = (await Product.findById(shoe._id).lean()).price;
  assert.equal(before, 270000); // its own 10% offer

  const created = await call('POST', '/api/admin/deals', {
    cookie: adminCookie,
    body: {
      product: String(shoe._id),
      percent: '25',
      startsAt: istInput(-5),
      endsAt: istInput(60),
      sortOrder: '1',
      isActive: true,
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.equal(created.data.deal.status, 'live');
  const dealId = created.data.deal.id;

  const during = await Product.findById(shoe._id).lean();
  assert.equal(during.dealOffer, 25);
  assert.equal(during.price, 225000);

  // The same product cannot have two deals at once.
  const clash = await call('POST', '/api/admin/deals', {
    cookie: adminCookie,
    body: {
      product: String(shoe._id),
      percent: '30',
      startsAt: istInput(10),
      endsAt: istInput(90),
      isActive: true,
    },
  });
  assert.equal(clash.status, 409);

  // The home page row leads with the admin's deal.
  const home = await productService.getHomeSections();
  assert.equal(String(home.deals[0]._id), String(shoe._id));
  assert.ok(home.adminDealEndsAt);

  const off = await call('PATCH', `/api/admin/deals/${dealId}/active`, {
    cookie: adminCookie,
    body: {isActive: false},
  });
  assert.equal(off.status, 200);
  assert.equal(off.data.deal.status, 'disabled');
  const after = await Product.findById(shoe._id).lean();
  assert.equal(after.dealOffer, 0);
  assert.equal(after.price, 270000);

  const removed = await call('DELETE', `/api/admin/deals/${dealId}`, {
    cookie: adminCookie,
  });
  assert.equal(removed.status, 200);
});

test('deals: they start and end on time through the sync job', async () => {
  const deal = await Deal.create({
    product: bottle._id,
    percent: 40,
    startsAt: new Date(Date.now() + 60 * 60000),
    endsAt: new Date(Date.now() + 120 * 60000),
  });
  await dealService.syncDealPrices();
  assert.equal((await Product.findById(bottle._id).lean()).price, 50000);

  // An hour and a half later: live.
  await dealService.syncDealPrices(new Date(Date.now() + 90 * 60000));
  assert.equal((await Product.findById(bottle._id).lean()).price, 30000);

  // Three hours later: over, usual price back.
  const result = await dealService.syncDealPrices(
    new Date(Date.now() + 180 * 60000),
  );
  assert.equal(result.cleared, 1);
  assert.equal((await Product.findById(bottle._id).lean()).price, 50000);
  await deal.deleteOne();
});

test('deals: the admin list pages and counts by status', async () => {
  const now = Date.now();
  for (let n = 0; n < 21; n += 1)
    await Deal.create({
      product: n % 2 ? shoe._id : bottle._id,
      percent: 5 + n,
      startsAt: new Date(now - (n + 2) * 24 * 3600000),
      endsAt: new Date(now - (n + 1) * 24 * 3600000),
    });
  const list = await call('GET', '/api/admin/deals?status=ended', {
    cookie: adminCookie,
  });
  assert.equal(list.status, 200);
  assert.equal(list.data.deals.length, 20);
  assert.equal(list.data.pagination.pages, 2);
  assert.equal(list.data.totals.ended, 21);
  const page = await call('GET', '/admin/deals?page=2', {cookie: adminCookie});
  assert.equal(page.status, 200);
  assert.match(page.data, /Deals of the day/);
  const form = await call('GET', '/admin/deals/new', {cookie: adminCookie});
  assert.equal(form.status, 200);
  assert.match(form.data, /data-pick-search/);
  // Shoppers never reach the deal API.
  assert.equal(
    (await call('GET', '/api/admin/deals', {cookie: shopperCookie})).status,
    401,
  );
});

// ======================= Smarter deal form =======================

test('deals: product search, several products at once (all or none), run again', async () => {
  const search = await call('GET', '/api/admin/deals/products?q=deal', {
    cookie: adminCookie,
  });
  assert.equal(search.status, 200);
  const names = search.data.products.map((p) => p.name);
  assert.ok(names.includes('Deal Trail Shoe'));
  assert.ok(search.data.products[0].image);

  const body = {
    products: [String(shoe._id), String(bottle._id)],
    percent: '12',
    startsAt: istInput(120),
    endsAt: istInput(240),
    isActive: true,
  };
  const made = await call('POST', '/api/admin/deals', {
    cookie: adminCookie,
    body,
  });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  assert.equal(made.data.deals.length, 2);
  assert.match(made.data.message, /2 deals saved/);

  // One of them clashes, so nothing in the batch is saved.
  const before = await Deal.countDocuments();
  const clash = await call('POST', '/api/admin/deals', {
    cookie: adminCookie,
    body: {...body, products: [String(shoe._id)], percent: '20'},
  });
  assert.equal(clash.status, 409);
  assert.equal(await Deal.countDocuments(), before);

  // Run again: the form comes back filled in from an ended deal.
  const ended = await Deal.create({
    product: bottle._id,
    percent: 33,
    note: 'Old flash sale',
    startsAt: new Date(Date.now() - 5 * 3600000),
    endsAt: new Date(Date.now() - 2 * 3600000),
  });
  const rerun = await call('GET', `/admin/deals/new?from=${ended._id}`, {
    cookie: adminCookie,
  });
  assert.equal(rerun.status, 200);
  assert.match(rerun.data, /Run it again/);
  assert.match(rerun.data, /value="33"/);
  assert.match(rerun.data, /Old flash sale/);
  assert.match(rerun.data, /data-pick-id="[a-f0-9]{24}"/);
  await Deal.deleteMany({});
  await dealService.syncDealPrices();
});

// ======================= One category and bulk move =======================

test('categories: the category page lists its products; products move in bulk', async () => {
  const sale = await Category.create({
    name: 'Clearance',
    nameKey: 'clearance',
    slug: 'clearance',
    offerPercent: 40,
    isListed: false,
  });
  const page = await call('GET', `/admin/categories/${running._id}`, {
    cookie: adminCookie,
  });
  assert.equal(page.status, 200);
  assert.match(page.data, /Deal Trail Shoe/);
  assert.match(page.data, /Add a product here/);
  assert.match(page.data, /<option value="[a-f0-9]{24}">Clearance \(hidden\)/);

  // The "add a product here" link picks the category in the product form.
  const form = await call('GET', `/admin/products/new?category=${sale._id}`, {
    cookie: adminCookie,
  });
  assert.match(form.data, new RegExp(`value="${sale._id}" selected`));

  assert.equal(
    (
      await call('POST', '/api/admin/categories/move-products', {
        cookie: adminCookie,
        body: {productIds: ['nope'], categoryId: String(sale._id)},
      })
    ).status,
    400,
  );
  const moved = await call('POST', '/api/admin/categories/move-products', {
    cookie: adminCookie,
    body: {productIds: [String(bottle._id)], categoryId: String(sale._id)},
  });
  assert.equal(moved.status, 200, JSON.stringify(moved.data));
  assert.equal(moved.data.moved, 1);
  const after = await Product.findById(bottle._id).lean();
  assert.equal(String(after.category), String(sale._id));
  assert.equal(after.categoryOffer, 40);
  assert.equal(after.categoryListed, false);
  assert.equal(after.price, 30000); // 50000 less the 40% category offer
  assert.ok(await AuditLog.findOne({action: 'category.products_moved'}).lean());

  // And back again.
  await call('POST', '/api/admin/categories/move-products', {
    cookie: adminCookie,
    body: {productIds: [String(bottle._id)], categoryId: String(running._id)},
  });
  assert.equal((await Product.findById(bottle._id).lean()).price, 50000);
  assert.equal(
    (
      await call('POST', '/api/admin/categories/move-products', {
        cookie: shopperCookie,
        body: {productIds: [String(bottle._id)], categoryId: String(sale._id)},
      })
    ).status,
    401,
  );
});

test('table footer: hidden when everything fits on one page, shown when there are more pages', async () => {
  // Two products in Running: one page, so no "Showing 1-2 of 2" footer.
  const short = await call('GET', `/admin/categories/${running._id}`, {
    cookie: adminCookie,
  });
  assert.equal(short.status, 200);
  assert.doesNotMatch(short.data, /class="admin-pager"/);
  // 23 categories at 20 per page: two pages, so the footer is there.
  for (let n = 0; n < 22; n += 1)
    await Category.create({
      name: `Pager ${n}`,
      nameKey: `pager ${n}`,
      slug: `pager-${n}`,
    });
  const long = await call('GET', '/admin/categories', {cookie: adminCookie});
  assert.match(long.data, /class="admin-pager"/);
  await Category.deleteMany({slug: /^pager-/});
});
