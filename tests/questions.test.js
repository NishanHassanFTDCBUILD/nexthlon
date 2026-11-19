// Review photos and product Q&A (E3). Own database ("_questions"); runs only with TEST_MONGODB_URI.
require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');

if (!process.env.TEST_MONGODB_URI) {
  test(
    'Q&A database tests (set TEST_MONGODB_URI to run them)',
    {skip: true},
    () => {},
  );
  return;
}

const mongoose = require('mongoose');
const sharp = require('sharp');
const app = require('../app');
const Product = require('../models/Product');
const Order = require('../models/Order');
const User = require('../models/User');
const Question = require('../models/Question');
const Job = require('../models/Job');
const categoryService = require('../services/categoryService');
const questionService = require('../services/questionService');

const dbUrl = new URL(process.env.TEST_MONGODB_URI);
dbUrl.pathname = `${dbUrl.pathname.replace(/\/$/, '')}_questions`;
let server;
let base;
let tent;

async function call(cookie, method, url, body) {
  const headers = {Accept: 'application/json', Origin: base};
  const isForm = body instanceof FormData;
  if (body !== undefined && !isForm)
    headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(base + url, {
    method,
    headers,
    body: body === undefined || isForm ? body : JSON.stringify(body),
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
async function customer(name, email) {
  const res = await call('', 'POST', '/api/signup', {
    name,
    email,
    password: 'secure2024run',
    confirmPassword: 'secure2024run',
  });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  return {cookie: res.cookies, user: await User.findOne({email})};
}

test.before(async () => {
  if (!/test/i.test(dbUrl.pathname))
    throw new Error("The Q&A test database must have 'test' in its name.");
  await mongoose.connect(dbUrl.href);
  await mongoose.connection.dropDatabase();
  await Promise.all(
    Object.values(mongoose.models).map((model) => model.syncIndexes()),
  );
  const outdoor = await categoryService.ensureCategory('Outdoor');
  categoryService.invalidate();
  tent = await Product.create({
    name: 'QA Tent',
    slug: 'qa-tent',
    category: outdoor._id,
    brand: 'Nexthlon',
    basePrice: 899900,
    mrp: 999900,
    stock: 5,
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

test('q&a: customers ask; only buyers who received it (or the team) answer; the asker is emailed', async () => {
  assert.equal(
    (
      await call('', 'POST', `/api/products/${tent._id}/questions`, {
        body: 'Does it fit four people?',
      })
    ).status,
    401,
  );
  const asker = await customer('Ask Er', 'asker@qa.test');
  assert.equal(
    (
      await call(asker.cookie, 'POST', `/api/products/${tent._id}/questions`, {
        body: 'short',
      })
    ).status,
    400,
  );
  const asked = await call(
    asker.cookie,
    'POST',
    `/api/products/${tent._id}/questions`,
    {body: 'Does it really fit four people with bags?'},
  );
  assert.equal(asked.status, 201, JSON.stringify(asked.data));
  const qid = asked.data.question.id;

  const stranger = await customer('Just Looking', 'stranger@qa.test');
  const refused = await call(
    stranger.cookie,
    'POST',
    `/api/questions/${qid}/answers`,
    {body: 'Probably.'},
  );
  assert.equal(refused.status, 403);
  assert.equal(refused.data.code, 'answer_not_buyer');

  const buyer = await customer('Camp Er', 'buyer@qa.test');
  await Order.create({
    orderId: 'NX-QA-1',
    user: buyer.user._id,
    items: [
      {
        product: tent._id,
        name: 'QA Tent',
        slug: 'qa-tent',
        price: 899900,
        mrp: 999900,
        quantity: 1,
        lineTotal: 899900,
        status: 'delivered',
      },
    ],
    address: {
      fullName: 'Camp Er',
      phone: '9876543210',
      line1: '1 Road',
      city: 'Kochi',
      state: 'Kerala',
      pincode: '682001',
    },
    mrpTotal: 999900,
    subtotal: 899900,
    total: 899900,
    paymentMethod: 'cod',
    paymentStatus: 'paid',
    orderStatus: 'delivered',
    deliveredAt: new Date(),
  });
  const answered = await call(
    buyer.cookie,
    'POST',
    `/api/questions/${qid}/answers`,
    {body: 'Four fit, bags go in the porch.'},
  );
  assert.equal(answered.status, 201, JSON.stringify(answered.data));
  assert.equal(answered.data.question.answers[0].verifiedBuyer, true);
  assert.ok(
    await Job.findOne({type: /question\.answered/}),
    'an email job for the asker',
  );

  const admin = await User.create({
    name: 'Store Team',
    email: 'team@qa.test',
    passwordHash: 'x'.repeat(60),
    role: 'admin',
  });
  const staff = await questionService.answer(
    admin,
    qid,
    'Yes, it is rated for four adults.',
  );
  assert.equal(staff.answers[1].author, 'Nexthlon team');
  assert.equal(staff.answers[1].isStaff, true);

  const listed = await call('', 'GET', `/api/products/${tent._id}/questions`);
  assert.equal(listed.data.questions.length, 1);
  assert.equal(listed.data.questions[0].answers.length, 2);
  await questionService.setHidden(qid, true);
  assert.equal(
    (await call('', 'GET', `/api/products/${tent._id}/questions`)).data
      .questions.length,
    0,
    'hidden questions never show',
  );
  assert.equal((await Question.findById(qid)).answerCount, 2);
});

test('review photos: up to 3 real photos are saved with the review; fake ones are refused', async () => {
  const reviewer = await customer('Photo Taker', 'photos@qa.test');
  const png = await sharp({
    create: {width: 40, height: 30, channels: 3, background: '#d4ff3a'},
  })
    .png()
    .toBuffer();
  const form = new FormData();
  form.append('rating', '5');
  form.append('title', 'Great tent');
  form.append('body', 'Stayed dry all night in heavy rain.');
  form.append('photos', new Blob([png], {type: 'image/png'}), 'camp.png');
  const res = await call(
    reviewer.cookie,
    'POST',
    `/api/products/${tent._id}/reviews`,
    form,
  );
  assert.equal(res.status, 201, JSON.stringify(res.data));
  assert.equal(res.data.review.photos.length, 1);
  assert.match(res.data.review.photos[0], /reviews\/[a-f0-9]+\.webp$/);

  const fake = new FormData();
  fake.append('rating', '4');
  fake.append('body', 'Nice tent, packs small enough.');
  fake.append(
    'photos',
    new Blob([Buffer.from('not really a picture at all')], {type: 'image/png'}),
    'fake.png',
  );
  assert.equal(
    (
      await call(
        reviewer.cookie,
        'POST',
        `/api/products/${tent._id}/reviews`,
        fake,
      )
    ).status,
    400,
  );
});
