// Product spreadsheet: export, preview (saves nothing), and apply (only a clean file is saved).
require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');

if (!process.env.TEST_MONGODB_URI) {
  test(
    'product spreadsheet tests (set TEST_MONGODB_URI to run them)',
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
dbUrl.pathname = `${dbUrl.pathname.replace(/\/$/, '')}_productcsv`;

let server;
let base;
let adminCookie;
let shoe;
let bottle;
let running;

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
  const text = await response.text();
  const data = type.includes('json') ? JSON.parse(text) : text;
  return {
    status: response.status,
    data,
    headers: response.headers,
    cookie: match && match[2] ? `${match[1]}=${match[2]}` : null,
  };
}

// A small CSV the way a spreadsheet writes it: quoted cells, CRLF line endings.
const csvOf = (header, rows) =>
  [header, ...rows]
    .map((cells) =>
      cells.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','),
    )
    .join('\r\n');

const HEADER = [
  'id',
  'name',
  'brand',
  'category',
  'price',
  'mrp',
  'offerPercent',
  'isListed',
];

test.before(async () => {
  if (!/test/i.test(dbUrl.pathname))
    throw new Error("The test database must have 'test' in its name.");
  await mongoose.connect(dbUrl.href);
  await mongoose.connection.dropDatabase();
  await Promise.all(
    Object.values(mongoose.models).map((model) => model.syncIndexes()),
  );
  await User.create({
    name: 'Sheet Admin',
    email: 'admin@sheet.test',
    passwordHash: await hashPassword('AdminPass123'),
    role: 'admin',
  });
  running = await categoryService.ensureCategory('Running');
  await categoryService.ensureCategory('Cycling');
  categoryService.invalidate();
  shoe = await Product.create({
    name: 'Sheet Shoe',
    slug: 'sheet-shoe',
    category: running._id,
    brand: 'Nexthlon',
    basePrice: 300000,
    mrp: 400000,
    stock: 4,
    image: '/img/favicon.svg',
  });
  bottle = await Product.create({
    name: 'Sheet Bottle',
    slug: 'sheet-bottle',
    category: running._id,
    brand: 'Nexthlon',
    basePrice: 50000,
    mrp: 60000,
    stock: 9,
    image: '/img/favicon.svg',
  });
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  adminCookie = (
    await call('POST', '/api/admin/login', {
      body: {email: 'admin@sheet.test', password: 'AdminPass123'},
    })
  ).cookie;
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  await new Promise((resolve) => server.close(resolve));
});

test('export: the catalogue downloads as a CSV the import accepts', async () => {
  const guest = await call('GET', '/api/admin/products/export.csv');
  assert.equal(guest.status, 401);
  const res = await call('GET', '/api/admin/products/export.csv', {
    cookie: adminCookie,
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/csv/);
  assert.match(res.headers.get('content-disposition'), /attachment/);
  const lines = res.data.trim().split(/\r?\n/);
  assert.equal(lines[0], HEADER.map((h) => `"${h}"`).join(','));
  assert.ok(lines.some((l) => l.includes(String(shoe._id))));
  // The file it writes is itself valid: previewing it changes nothing.
  const check = await call('POST', '/api/admin/products/import/preview', {
    cookie: adminCookie,
    body: {csv: res.data},
  });
  assert.equal(check.status, 200);
  assert.equal(check.data.summary.errors, 0);
  assert.equal(check.data.summary.changed, 0);
});

test('preview: every problem is listed by line, and nothing is saved', async () => {
  const csv = csvOf(HEADER, [
    [
      String(shoe._id),
      'Sheet Shoe',
      'Nexthlon',
      'Running',
      '2100',
      '3999',
      '15',
      'yes',
    ],
    [String(bottle._id), '', '', 'Nowhere', 'lots', '', '101', 'maybe'],
    ['not-an-id', 'X', '', '', '', '', '', ''],
  ]);
  const res = await call('POST', '/api/admin/products/import/preview', {
    cookie: adminCookie,
    body: {csv},
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.canApply, false);
  assert.equal(res.data.summary.errors, 2);
  const bad = res.data.rows.find((r) => r.id === String(bottle._id));
  assert.ok(bad.errors.some((e) => /category "Nowhere"/.test(e)));
  assert.ok(bad.errors.some((e) => /price/.test(e)));
  assert.ok(bad.errors.some((e) => /offerPercent/.test(e)));
  assert.ok(bad.errors.some((e) => /isListed/.test(e)));
  const good = res.data.rows.find((r) => r.id === String(shoe._id));
  assert.equal(good.changes.price.from, '3000.00');
  assert.equal(good.changes.price.to, '2100.00');
  // Nothing was saved by the preview.
  assert.equal((await Product.findById(shoe._id).lean()).basePrice, 300000);
});

test('apply: refuses a file with errors, and saves a clean one with an audit entry per product', async () => {
  const bad = await call('POST', '/api/admin/products/import/apply', {
    cookie: adminCookie,
    body: {
      csv: csvOf(HEADER, [
        [String(bottle._id), '', '', '', 'lots', '', '', ''],
      ]),
    },
  });
  assert.equal(bad.status, 409, 'a file with an error saves nothing');
  assert.equal((await Product.findById(bottle._id).lean()).basePrice, 50000);

  const ok = await call('POST', '/api/admin/products/import/apply', {
    cookie: adminCookie,
    body: {
      csv: csvOf(HEADER, [
        [String(shoe._id), '', '', 'Running', '2100', '3999', '15', 'yes'],
        [String(bottle._id), '', '', 'Running', '', '', '', 'no'],
      ]),
    },
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.saved, 2);
  const shoeNow = await Product.findById(shoe._id).lean();
  assert.equal(shoeNow.basePrice, 210000);
  assert.equal(shoeNow.mrp, 399900);
  assert.equal(shoeNow.offerPercent, 15);
  assert.equal(
    shoeNow.price,
    178500,
    'the price is worked out again: 2100 less the 15% offer',
  );
  assert.equal((await Product.findById(bottle._id).lean()).isListed, false);
  const audit = await AuditLog.findOne({
    target: `product:${shoe._id}`,
    action: 'product.updated',
  }).lean();
  assert.ok(audit, 'the change is audit-logged');
  assert.equal(audit.before.price, '3000.00');
  assert.equal(audit.after.price, '2100.00');
});

test('apply: a file that changes nothing is not saved, and a bad header is refused', async () => {
  const same = await call('POST', '/api/admin/products/import/apply', {
    cookie: adminCookie,
    body: {
      csv: csvOf(HEADER, [[String(shoe._id), '', '', '', '', '', '', '']]),
    },
  });
  assert.equal(same.status, 400);
  const header = await call('POST', '/api/admin/products/import/preview', {
    cookie: adminCookie,
    body: {csv: csvOf(['id', 'stock'], [[String(shoe._id), '5']])},
  });
  assert.equal(header.status, 400, 'stock is not in the file');
  assert.equal(await Category.countDocuments({name: 'Cycling'}), 1);
});
