// Back-in-stock alerts (E3): who may ask, one email per restock, and the signed "stop" link.
// Own database ("_stock_alerts"); runs only when TEST_MONGODB_URI is set (the signature test runs always).
require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const stockAlertService = require('../services/stockAlertService');

test("stock alerts: the stop link is signed, so nobody can stop someone else's alert", () => {
  const id = '6af844f55ff91a06140cbcc7';
  const sig = stockAlertService.signature(id);
  assert.equal(sig.length, 32);
  assert.notEqual(stockAlertService.signature('6af844f55ff91a06140cbcc8'), sig);
  assert.equal(
    stockAlertService.stopUrl('https://nexthlon.in', id),
    `https://nexthlon.in/stock-alerts/stop?id=${id}&sig=${sig}`,
  );
});

if (!process.env.TEST_MONGODB_URI) {
  test(
    'stock alert database tests (set TEST_MONGODB_URI to run them)',
    {skip: true},
    () => {},
  );
  return;
}

const mongoose = require('mongoose');
const app = require('../app');
const Product = require('../models/Product');
const StockAlert = require('../models/StockAlert');
const Job = require('../models/Job');
const categoryService = require('../services/categoryService');
const mailService = require('../services/mailService');

const dbUrl = new URL(process.env.TEST_MONGODB_URI);
dbUrl.pathname = `${dbUrl.pathname.replace(/\/$/, '')}_stock_alerts`;
let server;
let base;
let bat;
let shoe;
const outbox = [];

const post = (id, body) =>
  fetch(`${base}/api/products/${id}/stock-alerts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Origin: base,
    },
    body: JSON.stringify(body),
  }).then(async (res) => ({status: res.status, data: await res.json()}));

test.before(async () => {
  if (!/test/i.test(dbUrl.pathname))
    throw new Error(
      "The stock alert test database must have 'test' in its name.",
    );
  await mongoose.connect(dbUrl.href);
  await mongoose.connection.dropDatabase();
  await Promise.all(
    Object.values(mongoose.models).map((model) => model.syncIndexes()),
  );
  mailService.useTestOutbox(outbox);
  const cricket = await categoryService.ensureCategory('Cricket');
  categoryService.invalidate();
  bat = await Product.create({
    name: 'Alert Bat',
    slug: 'alert-bat',
    category: cricket._id,
    brand: 'Nexthlon',
    basePrice: 249900,
    mrp: 299900,
    stock: 0,
    image: '/img/favicon.svg',
  });
  shoe = await Product.create({
    name: 'Alert Shoe',
    slug: 'alert-shoe',
    category: cricket._id,
    brand: 'Nexthlon',
    basePrice: 499900,
    mrp: 599900,
    stock: 3,
    image: '/img/favicon.svg',
    variants: [
      {size: '8', stock: 3},
      {size: '9', stock: 0},
    ],
  });
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  mailService.useTestOutbox(null);
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  await new Promise((resolve) => server.close(resolve));
});

test('stock alerts: guests ask with an email; only sold-out products and sizes can be asked for', async () => {
  assert.equal((await post(bat._id, {email: 'not-an-email'})).status, 400);
  const ok = await post(bat._id, {email: 'Fan@Alerts.test '});
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
  assert.match(ok.data.message, /fan@alerts\.test/);
  assert.equal(
    (await post(bat._id, {email: 'fan@alerts.test'})).status,
    201,
    'asking twice is fine',
  );
  assert.equal(await StockAlert.countDocuments({product: bat._id}), 1);

  const inStock = await post(shoe._id, {email: 'fan@alerts.test'});
  assert.equal(
    inStock.status,
    400,
    'the shoe has sizes in stock: choose the sold-out one',
  );
  assert.equal(inStock.data.code, 'in_stock');
  const size8 = shoe.variants.find((v) => v.size === '8');
  const size9 = shoe.variants.find((v) => v.size === '9');
  assert.equal(
    (
      await post(shoe._id, {
        email: 'fan@alerts.test',
        variantId: String(size8._id),
      })
    ).status,
    400,
    'size 8 is in stock',
  );
  assert.equal(
    (
      await post(shoe._id, {
        email: 'fan@alerts.test',
        variantId: String(size9._id),
      })
    ).status,
    201,
  );
  assert.equal(
    (
      await post(shoe._id, {
        email: 'fan@alerts.test',
        variantId: '6af844f55ff91a06140cbcc7',
      })
    ).status,
    400,
    'not an option of this product',
  );
});

test('stock alerts: a restock emails each waiting shopper once, and only for what came back', async () => {
  outbox.length = 0;
  await StockAlert.create({email: 'second@alerts.test', product: bat._id});
  assert.equal(await stockAlertService.sweep(), 0, 'nothing is back yet');

  await Product.updateOne({_id: bat._id}, {$set: {stock: 5}});
  const queued = await stockAlertService.sweep();
  assert.equal(
    queued,
    2,
    'the two bat alerts; the size 9 shoe is still sold out',
  );
  const jobs = await Job.find({type: 'stock.alert'}).lean();
  assert.equal(jobs.length, 2);
  await stockAlertService.sweep();
  assert.equal(
    await Job.countDocuments({type: 'stock.alert'}),
    2,
    'a second sweep makes no duplicate jobs',
  );

  for (const job of jobs)
    assert.equal(await stockAlertService.notify(job.payload.alertId), 'sent');
  for (const job of jobs)
    assert.equal(
      await stockAlertService.notify(job.payload.alertId),
      'done',
      'never twice',
    );
  assert.equal(outbox.length, 2);
  assert.match(outbox[0].subject, /Back in stock: Alert Bat/);
  assert.match(outbox[0].text, /stock-alerts\/stop\?id=/);
  assert.ok(
    (await StockAlert.find({product: bat._id}).lean()).every(
      (alert) => alert.notifiedAt,
    ),
  );

  // Sold out again before the job ran: no email, and the alert keeps waiting.
  const size9 = shoe.variants.find((v) => v.size === '9');
  const waiting = await StockAlert.findOne({
    product: shoe._id,
    variant: size9._id,
  });
  assert.equal(
    await stockAlertService.notify(String(waiting._id)),
    'sold-again',
  );
  assert.equal((await StockAlert.findById(waiting._id)).notifiedAt, null);
});

test('stock alerts: the stop link removes the alert and goes back to the product', async () => {
  const alert = await StockAlert.findOne({
    email: 'fan@alerts.test',
    product: shoe._id,
  });
  const forged = await fetch(
    `${base}/stock-alerts/stop?id=${alert._id}&sig=${'A'.repeat(32)}`,
    {redirect: 'manual'},
  );
  assert.equal(forged.status, 404);
  const res = await fetch(
    `${base}/stock-alerts/stop?id=${alert._id}&sig=${stockAlertService.signature(String(alert._id))}`,
    {redirect: 'manual'},
  );
  assert.equal(res.status, 303);
  assert.equal(
    res.headers.get('location'),
    '/products/alert-shoe?alert=stopped',
  );
  assert.equal(await StockAlert.findById(alert._id), null);
});

test('stock alerts: one address can wait for at most 25 products at once', async () => {
  const cricket = await categoryService.ensureCategory('Cricket');
  const many = await Product.insertMany(
    Array.from({length: 26}, (_, i) => ({
      name: `Gone ${i}`,
      slug: `gone-${i}`,
      category: cricket._id,
      brand: 'Nexthlon',
      basePrice: 10000,
      mrp: 10000,
      price: 10000,
      stock: 0,
      image: '/img/favicon.svg',
      isListed: true,
      categoryListed: true,
    })),
  );
  for (const product of many.slice(0, 25))
    await stockAlertService.subscribe(product._id, {
      email: 'collector@alerts.test',
    });
  await assert.rejects(
    stockAlertService.subscribe(many[25]._id, {email: 'collector@alerts.test'}),
    (error) => error.reason === 'alert_limit',
  );
});
