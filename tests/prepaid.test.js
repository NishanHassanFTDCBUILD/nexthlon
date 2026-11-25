// Discount for paying online (E2): how much, when it applies, and how it flows into the order, GST and
// refunds. The sums run always; the order tests have their own database ("_prepaid") and run only when
// TEST_MONGODB_URI is set. Razorpay is a fake: nothing is sent.
require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const {orderTotals, prepaidDiscountFor} = require('../utils/pricing');
const rules = require('../utils/orderRules');
const {validatePrepaidSetting} = require('../utils/validators');

test('prepaid: a percent of the items after the coupon, capped, and only when paying online', () => {
  assert.equal(
    prepaidDiscountFor({percent: 5, max: 10000}, 100000),
    5000,
    '5% of ₹1,000 is ₹50',
  );
  assert.equal(
    prepaidDiscountFor({percent: 5, max: 10000}, 400000),
    10000,
    'capped at ₹100',
  );
  assert.equal(
    prepaidDiscountFor({percent: 5, max: 0}, 400000),
    20000,
    'no cap when the cap is 0',
  );
  assert.equal(prepaidDiscountFor({percent: 0, max: 10000}, 400000), 0, 'off');
  assert.equal(
    prepaidDiscountFor({percent: 3, max: 0}, 33333),
    900,
    'rounded down to whole rupees',
  );

  const base = {
    itemCount: 1,
    mrpTotal: 120000,
    subtotal: 100000,
    prepaid: {percent: 5, max: 10000},
  };
  const cod = orderTotals(base);
  assert.equal(cod.prepaidDiscount, 0);
  const online = orderTotals({...base, payOnline: true});
  assert.equal(online.prepaidDiscount, 5000);
  assert.equal(online.total, cod.total - 5000);
  assert.equal(
    online.deliveryFee,
    cod.deliveryFee,
    'delivery is never discounted, nor pushed over the free-delivery line',
  );

  const coupon = {
    code: 'TEN',
    type: 'percent',
    value: 10,
    maxDiscount: 0,
    minOrder: 0,
  };
  const withCoupon = orderTotals({...base, coupon, payOnline: true});
  assert.equal(withCoupon.couponDiscount, 10000);
  assert.equal(
    withCoupon.prepaidDiscount,
    4500,
    '5% of what is left after the coupon',
  );
});

test('prepaid: refunds share the online discount across items, like the coupon', () => {
  const order = {
    subtotal: 100000,
    couponDiscount: 0,
    prepaidDiscount: 5000,
    deliveryFee: 0,
    total: 95000,
    walletUsed: 0,
    refundedAmount: 0,
    paymentStatus: 'paid',
    items: [
      {_id: 'a', lineTotal: 60000, status: 'delivered'},
      {_id: 'b', lineTotal: 40000, status: 'delivered'},
    ],
  };
  assert.equal(
    rules.itemsValue(order, ['a']),
    57000,
    '₹600 less its ₹30 share',
  );
  assert.equal(
    rules.refundFor(order, ['a', 'b']),
    95000,
    'never more than was paid',
  );
});

test('prepaid: the admin setting is a whole percent up to 10 and a cap in rupees', () => {
  assert.deepEqual(
    validatePrepaidSetting({prepaidPercent: '5', prepaidMax: '100'}).value,
    {prepaidPercent: 5, prepaidMax: 10000},
  );
  assert.ok(
    validatePrepaidSetting({prepaidPercent: '11', prepaidMax: '100'}).errors
      .prepaidPercent,
  );
  assert.ok(
    validatePrepaidSetting({prepaidPercent: '2.5', prepaidMax: '100'}).errors
      .prepaidPercent,
  );
  assert.ok(
    validatePrepaidSetting({prepaidPercent: '5', prepaidMax: '5000'}).errors
      .prepaidMax,
  );
});

if (!process.env.TEST_MONGODB_URI) {
  test(
    'prepaid database tests (set TEST_MONGODB_URI to run them)',
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
const settingsService = require('../services/settingsService');
const razorpayService = require('../services/razorpayService');

const dbUrl = new URL(process.env.TEST_MONGODB_URI);
dbUrl.pathname = `${dbUrl.pathname.replace(/\/$/, '')}_prepaid`;
let server;
let base;
let shoe;
const gatewayOrders = [];

async function call(cookie, method, url, body) {
  const headers = {Accept: 'application/json', Origin: base};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(base + url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const set =
    typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : [];
  return {
    status: res.status,
    cookies: set.map((line) => line.split(';')[0]).join('; '),
    data: await res.json().catch(() => ({})),
  };
}

async function shopper(email) {
  const signup = await call('', 'POST', '/api/signup', {
    name: 'Online Payer',
    email,
    password: 'secure2024run',
    confirmPassword: 'secure2024run',
  });
  assert.equal(signup.status, 201, JSON.stringify(signup.data));
  const cookie = signup.cookies;
  const address = await call(cookie, 'POST', '/api/addresses', {
    fullName: 'Online Payer',
    phone: '9876543210',
    line1: '12 MG Road',
    city: 'Kochi',
    state: 'Kerala',
    pincode: '682001',
  });
  const addressId = (address.data.address || address.data.addresses[0])._id;
  await call(cookie, 'POST', '/api/cart/items', {
    productId: String(shoe._id),
    quantity: 1,
  });
  return {cookie, addressId};
}

test.before(async () => {
  if (!/test/i.test(dbUrl.pathname))
    throw new Error("The prepaid test database must have 'test' in its name.");
  await mongoose.connect(dbUrl.href);
  await mongoose.connection.dropDatabase();
  await Promise.all(
    Object.values(mongoose.models).map((model) => model.syncIndexes()),
  );
  const running = await categoryService.ensureCategory('Running');
  categoryService.invalidate();
  shoe = await Product.create({
    name: 'Prepaid Shoe',
    slug: 'prepaid-shoe',
    category: running._id,
    brand: 'Nexthlon',
    basePrice: 400000,
    mrp: 500000,
    stock: 20,
    image: '/img/favicon.svg',
  });
  razorpayService.setClient({
    orders: {
      create: async (params) => {
        gatewayOrders.push(params);
        return {
          id: `order_PRE${gatewayOrders.length}`,
          amount: params.amount,
          currency: 'INR',
        };
      },
    },
    payments: {refund: async () => ({id: 'rfnd_x', status: 'pending'})},
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

test('prepaid: off by default; once on, checkout shows the saving and the online order is charged less', async () => {
  const {cookie, addressId} = await shopper('payer.one@prepaid.test');
  let quote = (
    await call(cookie, 'POST', '/api/checkout/quote', {payOnline: true})
  ).data.quote;
  assert.equal(quote.totals.prepaidDiscount, 0);
  assert.equal(quote.onlineOffer, null);

  await settingsService.set('prepaidPercent', 5);
  await settingsService.set('prepaidMax', 10000);
  quote = (
    await call(cookie, 'POST', '/api/checkout/quote', {payOnline: false})
  ).data.quote;
  assert.equal(
    quote.totals.prepaidDiscount,
    0,
    'Cash on Delivery: no discount',
  );
  assert.deepEqual(
    quote.onlineOffer,
    {percent: 5, max: 10000, saving: 10000},
    'but the cards say what paying online would save',
  );
  const codTotal = quote.totals.total;
  quote = (await call(cookie, 'POST', '/api/checkout/quote', {payOnline: true}))
    .data.quote;
  assert.equal(
    quote.totals.prepaidDiscount,
    10000,
    '5% of ₹4,000 is ₹200, capped at ₹100',
  );
  assert.equal(quote.totals.total, codTotal - 10000);

  const pay = await call(cookie, 'POST', '/api/payments/razorpay/order', {
    addressId,
  });
  assert.equal(pay.status, 201, JSON.stringify(pay.data));
  const order = await Order.findOne({
    'razorpay.orderId': pay.data.razorpay_order_id,
  });
  assert.equal(order.prepaidDiscount, 10000);
  assert.equal(order.total, codTotal - 10000);
  assert.equal(
    gatewayOrders.at(-1).amount,
    order.total,
    'Razorpay is asked for the discounted amount',
  );
  assert.equal(order.gst, undefined);
  assert.ok(order.items.every((item) => !item.tax));
});

test('prepaid: Cash on Delivery orders never get it, even when the browser asks', async () => {
  await settingsService.set('prepaidPercent', 5);
  const {cookie, addressId} = await shopper('payer.two@prepaid.test');
  const placed = await call(cookie, 'POST', '/api/orders', {
    addressId,
    paymentMethod: 'cod',
    payOnline: true,
  });
  assert.equal(placed.status, 201, JSON.stringify(placed.data));
  const order = await Order.findOne({orderId: placed.data.order.orderId});
  assert.equal(order.prepaidDiscount, 0);
});
