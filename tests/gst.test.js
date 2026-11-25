// GST invoices (B4): the tax split, rounding, coupon sharing, numbering, credit notes and the PDFs.
// The rules run without a database; the order flow needs TEST_MONGODB_URI (own database "_gst").
require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const gst = require('../utils/gst');

const shoe = {hsn: '6404', rate: 5, rateAbove: 18, above: 250000};
const ball = {hsn: '9506', rate: 5, rateAbove: null, above: null};

test('gst: Kerala to Kerala is CGST + SGST, Kerala to Delhi is IGST, and the money adds up exactly', () => {
  const lines = [
    {lineTotal: 199900, price: 199900, quantity: 1, tax: shoe},
    {lineTotal: 99800, price: 49900, quantity: 2, tax: ball},
  ];
  const inside = gst.orderTax({
    lines,
    sellerState: 'Kerala',
    buyerState: 'Kerala',
  });
  assert.equal(inside.interstate, false);
  assert.ok(
    inside.lines.every(
      (line) => line.igst === 0 && line.cgst > 0 && line.sgst > 0,
    ),
  );
  // ₹1,999 shoe at 5%: 190381 + 9519 tax, split 4760 + 4759.
  assert.deepEqual(inside.lines[0], {
    hsn: '6404',
    rate: 5,
    discount: 0,
    value: 199900,
    taxable: 190381,
    cgst: 4760,
    sgst: 4759,
    igst: 0,
  });

  const across = gst.orderTax({
    lines,
    sellerState: 'Kerala',
    buyerState: 'Delhi',
  });
  assert.equal(across.interstate, true);
  assert.equal(across.placeOfSupply, 'Delhi');
  assert.ok(
    across.lines.every(
      (line) => line.cgst === 0 && line.sgst === 0 && line.igst > 0,
    ),
  );
  assert.equal(
    across.totals.tax,
    inside.totals.tax,
    'the same tax, only split differently',
  );
  for (const result of [inside, across]) {
    assert.equal(
      result.totals.taxable + result.totals.tax,
      result.totals.value,
    );
    assert.equal(result.totals.value, 299700);
  }
});

test('gst: footwear above ₹2,500 a piece is 18%, and a coupon is shared out before tax', () => {
  assert.equal(
    gst.rateFor(shoe, 262500),
    5,
    '₹2,625 with tax is ₹2,500 before tax: still 5%',
  );
  assert.equal(gst.rateFor(shoe, 262600), 18);
  assert.equal(gst.rateFor(ball, 999900), 5, 'one rate only');

  const result = gst.orderTax({
    lines: [
      {lineTotal: 299900, price: 299900, quantity: 1, tax: shoe},
      {lineTotal: 100100, price: 100100, quantity: 1, tax: ball},
    ],
    couponDiscount: 40000,
    deliveryFee: 4000,
    sellerState: 'Kerala',
    buyerState: 'Kerala',
  });
  assert.equal(result.lines[0].rate, 18);
  assert.deepEqual(
    result.lines.map((line) => line.discount),
    [29990, 10010],
    'shared by value, to the paisa',
  );
  assert.equal(
    result.delivery.rate,
    18,
    'delivery takes the highest rate in the order',
  );
  assert.equal(result.totals.value, 299900 + 100100 - 40000 + 4000);
  assert.equal(result.totals.taxable + result.totals.tax, result.totals.value);
});

test('gst: shares, words, financial years and suggestions', () => {
  assert.deepEqual(gst.shareOut(100, [1, 1, 1]), [34, 33, 33]);
  assert.deepEqual(gst.shareOut(0, [5, 5]), [0, 0]);
  assert.equal(
    gst.amountInWords(299700),
    'Two thousand nine hundred ninety-seven rupees only',
  );
  assert.equal(
    gst.amountInWords(12345678950),
    'Twelve crore thirty-four lakh fifty-six thousand seven hundred eighty-nine rupees and fifty paise only',
  );
  assert.equal(
    gst.financialYear(new Date('2027-03-31T12:00:00+05:30')),
    '26-27',
  );
  assert.equal(
    gst.financialYear(new Date('2027-04-01T00:30:00+05:30')),
    '27-28',
    'India time decides',
  );
  assert.equal(gst.suggestTax('TrailFlex 2 Trail Running Shoes').hsn, '6404');
  assert.equal(gst.suggestTax('Pro Match Football').hsn, '9506');
  assert.equal(gst.suggestTax('Dri-fit Training T-shirt').rateAbove, 18);
  assert.equal(gst.STATE_CODES.Kerala, '32');
  assert.equal(gst.STATE_CODES.Delhi, '07');
});

test('new product edits ignore retired GST fields', () => {
  const {validateProduct} = require('../utils/validators');
  const result = validateProduct({
    name: 'Trail shoe',
    category: 'c'.repeat(24),
    price: '1000',
    mrp: '1200',
    stock: '3',
    hsn: '6404',
    gstRate: '18',
  });
  assert.equal(result.value.tax, undefined);
  assert.equal(result.errors.gstRate, undefined);
});

if (!process.env.TEST_MONGODB_URI) {
  test(
    'gst database tests (set TEST_MONGODB_URI to run them)',
    {skip: true},
    () => {},
  );
  return;
}

const mongoose = require('mongoose');
const app = require('../app');
const Product = require('../models/Product');
const Order = require('../models/Order');
const categoryService = require('../services/categoryService');

const dbUrl = new URL(process.env.TEST_MONGODB_URI);
dbUrl.pathname = `${dbUrl.pathname.replace(/\/$/, '')}_gst`;

let server;
let base;
let boot;
let football;
let shopper;
const addresses = {};

function jar() {
  const cookies = new Map();
  return {
    header: () =>
      [...cookies].map(([name, value]) => `${name}=${value}`).join('; '),
    take(response) {
      const all =
        typeof response.headers.getSetCookie === 'function'
          ? response.headers.getSetCookie()
          : [response.headers.get('set-cookie') || ''];
      all.filter(Boolean).forEach((line) => {
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
  const data = type.includes('json')
    ? await response.json()
    : type.includes('pdf')
      ? Buffer.from(await response.arrayBuffer())
      : await response.text();
  return {
    status: response.status,
    type,
    disposition: response.headers.get('content-disposition') || '',
    data,
  };
}

async function order(state, items) {
  for (const [product, quantity] of items) {
    const added = await call(shopper, 'POST', '/api/cart/items', {
      productId: String(product._id),
      quantity,
    });
    assert.equal(added.status, 201, JSON.stringify(added.data));
  }
  const placed = await call(shopper, 'POST', '/api/orders', {
    addressId: addresses[state],
    paymentMethod: 'cod',
  });
  assert.equal(placed.status, 201, JSON.stringify(placed.data));
  // These tests place many orders for one shopper: count earlier ones as paid, so the cap on unpaid
  // Cash on Delivery orders on the way (checkoutService.MAX_OPEN_COD) stays out of the way.
  const saved = await Order.findOne({
    orderId: placed.data.order.orderId,
  }).lean();
  await Order.updateMany(
    {user: saved.user, _id: {$ne: saved._id}, paymentMethod: 'cod'},
    {$set: {paymentStatus: 'paid'}},
  );
  return saved;
}

test.before(async () => {
  if (!/test/i.test(dbUrl.pathname))
    throw new Error("The GST test database must have 'test' in its name.");
  await mongoose.connect(dbUrl.href);
  await mongoose.connection.dropDatabase();
  await Promise.all(
    Object.values(mongoose.models).map((model) => model.syncIndexes()),
  );
  const running = await categoryService.ensureCategory('Running');
  categoryService.invalidate();
  boot = await Product.create({
    name: 'GST Trail Running Shoes',
    slug: 'gst-trail-shoes',
    category: running._id,
    brand: 'Nexthlon',
    basePrice: 199900,
    mrp: 249900,
    stock: 20,
    image: '/img/favicon.svg',
    tax: {hsn: '6404', rate: 5, rateAbove: 18, above: 250000},
    countryOfOrigin: 'Vietnam',
    manufacturer: 'Nexthlon Imports, Kochi',
    netQuantity: '1 pair',
  });
  await Product.create({
    name: 'GST Running Socks',
    slug: 'gst-running-socks',
    category: running._id,
    brand: 'Nexthlon',
    basePrice: 19900,
    mrp: 24900,
    stock: 20,
    image: '/img/favicon.svg',
  });
  football = await Product.create({
    name: 'GST Match Football',
    slug: 'gst-match-football',
    category: running._id,
    brand: 'Nexthlon',
    basePrice: 49900,
    mrp: 59900,
    stock: 20,
    image: '/img/favicon.svg',
  });
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  shopper = jar();
  const signup = await call(shopper, 'POST', '/api/signup', {
    name: 'Tax Shopper',
    email: 'tax.shopper@gst.test',
    password: 'taxes2024run',
    confirmPassword: 'taxes2024run',
  });
  assert.equal(signup.status, 201, JSON.stringify(signup.data));
  for (const [state, city, pincode] of [
    ['Kerala', 'Kochi', '682001'],
    ['Delhi', 'New Delhi', '110001'],
  ]) {
    const made = await call(shopper, 'POST', '/api/addresses', {
      fullName: 'Tax Shopper',
      phone: '9876543210',
      line1: '12 Main Road',
      city,
      state,
      pincode,
    });
    assert.equal(made.status, 201, JSON.stringify(made.data));
    const saved =
      made.data.address || made.data.addresses.find((a) => a.state === state);
    addresses[state] = saved.id || saved._id;
  }
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  await new Promise((resolve) => server.close(resolve));
});

test('new orders have no GST snapshots and still provide a receipt', async () => {
  for (const state of ['Kerala', 'Delhi']) {
    const placed = await order(state, [
      [boot, 1],
      [football, 1],
    ]);
    assert.equal(placed.gst, undefined);
    assert.ok(placed.items.every((item) => !item.tax));
    const pdf = await call(
      shopper,
      'GET',
      '/orders/' + placed.orderId + '/invoice',
    );
    assert.equal(pdf.status, 200);
    assert.equal(pdf.data.subarray(0, 4).toString(), '%PDF');
  }
});

test('product page retains product details without GST wording', async () => {
  const page = await call(jar(), 'GET', '/products/' + boot.slug);
  assert.match(page.data, /Country of origin/);
  assert.doesNotMatch(page.data, /Inclusive of all taxes \(GST\)/);
});
