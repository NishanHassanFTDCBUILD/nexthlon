// Step 6: customer 360 and segments, review moderation, and the support inbox.
require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const {segmentsOf} = require('../utils/customerSegments');

// ---------- Rules that need no database ----------

test('segments: each rule adds its label, and a customer can have several', () => {
  assert.deepEqual(segmentsOf({orderCount: 0, joinedDays: 100}), [
    'No orders yet',
  ]);
  assert.deepEqual(
    segmentsOf({joinedDays: 5, orderCount: 1, deliveredCount: 1}),
    ['New'],
  );
  const loyal = segmentsOf({
    joinedDays: 400,
    orderCount: 4,
    deliveredCount: 3,
    paidTotal: 1500000,
  });
  assert.ok(loyal.includes('Loyal'));
  assert.ok(loyal.includes('High value'));
  assert.deepEqual(
    segmentsOf({
      joinedDays: 400,
      orderCount: 2,
      deliveredCount: 2,
      lastOrderDays: 200,
    }),
    ['At risk'],
  );
  assert.ok(
    segmentsOf({returnedCount: 2, orderCount: 3}).includes('Returns often'),
  );
  assert.ok(segmentsOf({blocked: true}).includes('Blocked'));
});

if (!process.env.TEST_MONGODB_URI) {
  test(
    'customer, review and support tests (set TEST_MONGODB_URI to run them)',
    {skip: true},
    () => {},
  );
  return;
}

const mongoose = require('mongoose');
const app = require('../app');
const User = require('../models/User');
const Product = require('../models/Product');
const Review = require('../models/Review');
const Order = require('../models/Order');
const AuditLog = require('../models/AuditLog');
const categoryService = require('../services/categoryService');
const supportService = require('../services/supportService');
const {hashPassword} = require('../services/authService');

const dbUrl = new URL(process.env.TEST_MONGODB_URI);
dbUrl.pathname = `${dbUrl.pathname.replace(/\/$/, '')}_step6`;

let server;
let base;
let adminCookie;
let packingCookie;
let shoe;
let buyer;
let ticket;
let review;

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
  await User.create({
    name: 'Step Six Admin',
    email: 'admin@six.test',
    passwordHash: await hashPassword('AdminPass123'),
    role: 'admin',
  });
  await User.create({
    name: 'Packing Person',
    email: 'packing@six.test',
    passwordHash: await hashPassword('AdminPass123'),
    role: 'admin',
    adminRole: 'packing',
  });
  buyer = await User.create({
    name: 'Ravi Menon',
    email: 'ravi@six.test',
    passwordHash: await hashPassword('trail2024'),
    role: 'customer',
    emailVerifiedAt: new Date(),
    createdAt: new Date(Date.now() - 400 * 24 * 3600 * 1000),
  });
  const running = await categoryService.ensureCategory('Running');
  categoryService.invalidate();
  shoe = await Product.create({
    name: 'Six Shoe',
    slug: 'six-shoe',
    category: running._id,
    brand: 'Nexthlon',
    basePrice: 300000,
    mrp: 400000,
    stock: 9,
    image: '/img/favicon.svg',
  });
  await Order.create({
    orderId: 'NX-2026-930001',
    user: buyer._id,
    items: [
      {
        product: shoe._id,
        name: shoe.name,
        slug: shoe.slug,
        price: shoe.price,
        mrp: shoe.mrp,
        quantity: 1,
        lineTotal: shoe.price,
        status: 'delivered',
      },
    ],
    address: {
      fullName: 'Ravi Menon',
      phone: '9876543210',
      line1: '4 Lake Road',
      city: 'Kochi',
      state: 'Kerala',
      pincode: '682001',
    },
    mrpTotal: shoe.mrp,
    subtotal: shoe.price,
    total: shoe.price,
    paymentMethod: 'razorpay',
    paymentStatus: 'paid',
    orderStatus: 'delivered',
    deliveredAt: new Date(),
    stockReserved: true,
    statusHistory: [],
  });
  review = await Review.create({
    product: shoe._id,
    user: buyer._id,
    authorName: 'Ravi M.',
    rating: 1,
    title: 'Broke in a week',
    body: 'Sole came off after one run. Not what the photos show.',
  });
  ticket = await supportService.createTicket(buyer, {
    topic: 'Order',
    subject: 'Where is my parcel?',
    message: 'It was due yesterday and I have no update.',
    orderId: 'NX-2026-930001',
  });
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  adminCookie = (
    await call('POST', '/api/admin/login', {
      body: {email: 'admin@six.test', password: 'AdminPass123'},
    })
  ).cookie;
  packingCookie = (
    await call('POST', '/api/admin/login', {
      body: {email: 'packing@six.test', password: 'AdminPass123'},
    })
  ).cookie;
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  await new Promise((resolve) => server.close(resolve));
});

test('reviews: a review is hidden with a reason, the rating follows, and it can be shown again', async () => {
  const noReason = await call(
    'PATCH',
    `/api/admin/reviews/${review._id}/hidden`,
    {
      cookie: adminCookie,
      body: {hidden: true, reason: ''},
    },
  );
  assert.equal(noReason.status, 400, 'a hidden review needs a reason');

  const hidden = await call(
    'PATCH',
    `/api/admin/reviews/${review._id}/hidden`,
    {
      cookie: adminCookie,
      body: {hidden: true, reason: 'Off topic'},
    },
  );
  assert.equal(hidden.status, 200, JSON.stringify(hidden.data));
  const after = await Review.findById(review._id).lean();
  assert.equal(after.isHidden, true);
  assert.equal(after.hiddenReason, 'Off topic');
  const product = await Product.findById(shoe._id).lean();
  assert.equal(product.ratingCount, 0, 'the hidden review leaves the average');
  assert.ok(
    await AuditLog.findOne({
      action: 'review.hidden',
      target: `review:${review._id}`,
    }),
  );

  const list = await call('GET', '/api/admin/reviews?status=hidden', {
    cookie: adminCookie,
  });
  assert.equal(list.data.reviews.length, 1);
  assert.match(
    (await call('GET', '/admin/reviews', {cookie: adminCookie})).data,
    /Reviews/,
  );

  const shown = await call('PATCH', `/api/admin/reviews/${review._id}/hidden`, {
    cookie: adminCookie,
    body: {hidden: false},
  });
  assert.equal(shown.status, 200);
  assert.equal((await Product.findById(shoe._id).lean()).ratingCount, 1);
});

test('support: the inbox lists requests; a reply uses a ready-made text, sets the status and is audited', async () => {
  const inbox = await call('GET', '/admin/support', {cookie: adminCookie});
  assert.equal(inbox.status, 200);
  assert.match(inbox.data, /Where is my parcel\?/);

  const page = await call('GET', `/admin/support/${ticket.ticketId}`, {
    cookie: adminCookie,
  });
  assert.equal(page.status, 200);
  assert.match(page.data, /Ready-made reply/);
  assert.match(page.data, /Refund timing/);

  const reply = await call(
    'POST',
    `/api/admin/tickets/${ticket.ticketId}/reply`,
    {
      cookie: adminCookie,
      body: {
        message: 'We have checked with the courier and will update you today.',
        status: 'resolved',
      },
    },
  );
  assert.equal(reply.status, 200, JSON.stringify(reply.data));
  assert.ok(await AuditLog.findOne({action: 'support.replied'}));

  const refused = await call(
    'POST',
    `/api/admin/tickets/${ticket.ticketId}/reply`,
    {
      cookie: packingCookie,
      body: {message: 'Hello there', status: 'pending'},
    },
  );
  assert.equal(refused.status, 403, 'packing cannot answer customers');
});

test('customer 360: profile, segments and the private note, which is audited and limited by role', async () => {
  const page = await call('GET', `/admin/customers/${buyer._id}`, {
    cookie: adminCookie,
  });
  assert.equal(page.status, 200);
  assert.match(page.data, /Ravi Menon/);
  assert.match(page.data, /Private note/);

  const profile = await call(
    'GET',
    `/api/admin/customers/${buyer._id}/profile`,
    {cookie: adminCookie},
  );
  assert.equal(profile.status, 200);
  assert.equal(profile.data.summary.orders, 1);
  assert.equal(profile.data.summary.delivered, 1);
  assert.equal(profile.data.customer.emailVerified, true);

  const note = await call('PATCH', `/api/admin/customers/${buyer._id}/note`, {
    cookie: adminCookie,
    body: {note: 'Prefers morning deliveries.'},
  });
  assert.equal(note.status, 200);
  assert.equal(
    (await User.findById(buyer._id).lean()).adminNote,
    'Prefers morning deliveries.',
  );
  assert.ok(await AuditLog.findOne({action: 'customer.note_changed'}));

  assert.equal(
    (
      await call('PATCH', `/api/admin/customers/${buyer._id}/note`, {
        cookie: packingCookie,
        body: {note: 'Packing wrote this'},
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await call('GET', '/api/admin/customers/nope/profile', {
        cookie: adminCookie,
      })
    ).status,
    404,
  );
});
