// Step 7: the webhook log, the job queue, and the GST report.
require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const {currentMonth, monthRange} = require('../services/gstReportService');
const webhookLogService = require('../services/webhookLogService');

// ---------- Rules that need no database ----------

test('GST: a month runs from midnight India time on the 1st to midnight on the next 1st', () => {
  const {start, end} = monthRange('2026-11');
  assert.equal(start.toISOString(), '2026-10-31T18:30:00.000Z');
  assert.equal(end.toISOString(), '2026-11-30T18:30:00.000Z');
  assert.equal(
    monthRange('2026-12').end.toISOString(),
    '2026-12-31T18:30:00.000Z',
  );
  // 20:00 UTC on 30 November is already 1 December in India.
  assert.equal(currentMonth(new Date('2026-11-30T20:00:00Z')), '2026-12');
  assert.throws(() => monthRange('2026-13'));
});

test('webhook log: a Razorpay body is read for its event and the id it is about', () => {
  const body = JSON.stringify({
    event: 'payment.captured',
    payload: {payment: {entity: {id: 'pay_123'}}},
  });
  assert.deepEqual(webhookLogService.describeRazorpay(body), {
    event: 'payment.captured',
    externalId: 'pay_123',
  });
  assert.deepEqual(webhookLogService.describeRazorpay('not json'), {
    event: '',
    externalId: '',
  });
});

if (!process.env.TEST_MONGODB_URI) {
  test(
    'ops and finance tests (set TEST_MONGODB_URI to run them)',
    {skip: true},
    () => {},
  );
  return;
}

const mongoose = require('mongoose');
const app = require('../app');
const User = require('../models/User');
const Order = require('../models/Order');
const WebhookEvent = require('../models/WebhookEvent');
const {hashPassword} = require('../services/authService');
const paymentService = require('../services/paymentService');

const dbUrl = new URL(process.env.TEST_MONGODB_URI);
dbUrl.pathname = `${dbUrl.pathname.replace(/\/$/, '')}_ops`;

let server;
let base;
let ownerCookie;
let packingCookie;
let owner;

async function call(method, path, {body, cookie, raw, headers: extra} = {}) {
  const headers = {
    Accept: 'application/json,text/html',
    Origin: base,
    ...(extra || {}),
  };
  if (body !== undefined || raw !== undefined)
    headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(base + path, {
    method,
    headers,
    redirect: 'manual',
    body:
      raw !== undefined
        ? raw
        : body === undefined
          ? undefined
          : JSON.stringify(body),
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
  owner = await User.create({
    name: 'Ops Owner',
    email: 'owner@ops.test',
    passwordHash: await hashPassword('AdminPass123'),
    role: 'admin',
  });
  await User.create({
    name: 'Ops Packing',
    email: 'packing@ops.test',
    passwordHash: await hashPassword('AdminPass123'),
    role: 'admin',
    adminRole: 'packing',
  });
  await User.create({
    name: 'Ops Manager',
    email: 'manager@ops.test',
    passwordHash: await hashPassword('AdminPass123'),
    role: 'admin',
    adminRole: 'manager',
  });
  // An invoiced order in November (India time), for the GST report.
  await Order.create({
    orderId: 'NX-2026-940001',
    user: owner._id,
    items: [
      {
        product: new mongoose.Types.ObjectId(),
        name: 'GST Shoe',
        slug: 'gst-shoe',
        price: 118000,
        mrp: 130000,
        quantity: 1,
        lineTotal: 118000,
        status: 'delivered',
      },
    ],
    address: {
      fullName: 'Tax Buyer',
      phone: '9876543210',
      line1: '7 Market Road',
      city: 'Kochi',
      state: 'Kerala',
      pincode: '682001',
    },
    mrpTotal: 130000,
    subtotal: 118000,
    total: 118000,
    paymentMethod: 'razorpay',
    paymentStatus: 'paid',
    orderStatus: 'delivered',
    stockReserved: true,
    statusHistory: [],
    gst: {
      scheme: 'regular',
      sellerState: 'Kerala',
      placeOfSupply: 'Kerala',
      interstate: false,
      taxable: 100000,
      cgst: 9000,
      sgst: 9000,
      igst: 0,
      tax: 18000,
      value: 118000,
      invoiceNo: 'NX/2026-27/000001',
      invoiceDate: new Date('2026-11-10T06:00:00Z'),
    },
  });
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  ownerCookie = (
    await call('POST', '/api/admin/login', {
      body: {email: 'owner@ops.test', password: 'AdminPass123'},
    })
  ).cookie;
  packingCookie = (
    await call('POST', '/api/admin/login', {
      body: {email: 'packing@ops.test', password: 'AdminPass123'},
    })
  ).cookie;
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  await new Promise((resolve) => server.close(resolve));
});

test('GST: the month report lists the invoice with its tax, totals it, and downloads as CSV', async () => {
  const csv = await call('GET', '/api/admin/reports/gst.csv?month=2026-11', {
    cookie: ownerCookie,
  });
  assert.equal(csv.status, 200);
  assert.match(csv.data, /NX\/2026-27\/000001/);
  assert.match(csv.data, /"1000\.00"/);
  assert.match(csv.data, /"180\.00"/);
  assert.match(csv.data, /"1180\.00"/);
  assert.match(csv.data, /1 invoices/);
  const empty = await call('GET', '/api/admin/reports/gst.csv?month=2026-10', {
    cookie: ownerCookie,
  });
  assert.doesNotMatch(empty.data, /NX\/2026-27/);
  assert.equal(
    (await call('GET', '/admin/gst?month=2026-11', {cookie: ownerCookie}))
      .status,
    200,
  );
  assert.equal(
    (await call('GET', '/api/admin/reports/gst.csv', {cookie: packingCookie}))
      .status,
    403,
  );
});

test('webhooks: a Razorpay call with a bad signature is refused and logged, not acted on', async () => {
  const raw = JSON.stringify({
    event: 'payment.captured',
    payload: {payment: {entity: {id: 'pay_bad'}}},
  });
  const res = await call('POST', '/api/payments/razorpay/webhook', {
    raw,
    headers: {'x-razorpay-signature': 'nope'},
  });
  assert.equal(res.status, 400);
  const logged = await WebhookEvent.findOne({externalId: 'pay_bad'}).lean();
  assert.ok(logged, 'the refused call is in the log');
  assert.equal(logged.signatureOk, false);
  assert.equal(logged.outcome, 'rejected');
  assert.equal(logged.event, 'payment.captured');
});

test('webhooks: a courier call with the wrong token is refused and logged', async () => {
  const res = await call('POST', '/api/webhooks/courier', {
    body: {awb: 'AWB1', current_status: 'DELIVERED'},
    headers: {'x-api-key': 'wrong'},
  });
  assert.equal(res.status, 401);
  assert.ok(
    await WebhookEvent.findOne({
      provider: 'shiprocket',
      outcome: 'rejected',
    }).lean(),
  );
});

test('webhooks: the log lists with filters; only a good payment event can be run again', async () => {
  const list = await call('GET', '/api/admin/webhooks?provider=razorpay', {
    cookie: ownerCookie,
  });
  assert.equal(list.status, 200);
  assert.ok(list.data.events.every((e) => e.provider === 'razorpay'));
  assert.equal(
    (await call('GET', '/admin/webhooks', {cookie: ownerCookie})).status,
    200,
  );
  assert.equal(
    (await call('GET', '/admin/webhooks', {cookie: packingCookie})).status,
    403,
  );

  const bad = await WebhookEvent.findOne({externalId: 'pay_bad'}).lean();
  const refused = await call('POST', `/api/admin/webhooks/${bad._id}/rerun`, {
    cookie: ownerCookie,
  });
  assert.equal(refused.status, 400, 'a refused event cannot be run again');

  // A good event is run again through the same handler, with its stored body and signature.
  const good = await WebhookEvent.create({
    provider: 'razorpay',
    event: 'payment.captured',
    externalId: 'pay_good',
    signatureOk: true,
    outcome: 'processed',
    rawBody: JSON.stringify({event: 'payment.captured'}),
    signature: 'sig',
  });
  const original = paymentService.handleWebhook;
  let seen = null;
  paymentService.handleWebhook = async (raw, signature) => {
    seen = {raw: raw.toString('utf8'), signature};
  };
  try {
    const run = await webhookLogService.rerun(good._id, (raw, signature) =>
      paymentService.handleWebhook(raw, signature),
    );
    assert.equal(run.externalId, 'pay_good');
    assert.equal(seen.signature, 'sig');
    assert.match(seen.raw, /payment\.captured/);
    assert.ok(
      await WebhookEvent.findOne({
        externalId: 'pay_good',
        outcome: 'rerun',
      }).lean(),
    );
  } finally {
    paymentService.handleWebhook = original;
  }
});
