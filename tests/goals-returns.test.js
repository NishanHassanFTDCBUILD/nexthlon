// Step 9 slice: the monthly revenue goal and the return-reasons report.
require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const {monthRange, currentMonth} = require('../services/gstReportService');

test('goal month: a month is a calendar month in India time, and the current month is found', () => {
  assert.equal(
    monthRange('2026-02').start.toISOString(),
    '2026-01-31T18:30:00.000Z',
  );
  assert.equal(typeof currentMonth(), 'string');
});

if (!process.env.TEST_MONGODB_URI) {
  test(
    'goal and returns tests (set TEST_MONGODB_URI to run them)',
    {skip: true},
    () => {},
  );
} else {
  const mongoose = require('mongoose');
  const app = require('../app');
  const User = require('../models/User');
  const Product = require('../models/Product');
  const Order = require('../models/Order');
  const AuditLog = require('../models/AuditLog');
  const categoryService = require('../services/categoryService');
  const revenueGoalService = require('../services/revenueGoalService');
  const returnReasonsService = require('../services/returnReasonsService');
  const {hashPassword} = require('../services/authService');

  const dbUrl = new URL(process.env.TEST_MONGODB_URI);
  dbUrl.pathname = `${dbUrl.pathname.replace(/\/$/, '')}_goals`;
  let server;
  let base;
  let owner;
  let financeCookie;
  let ownerCookie;
  let shoe;

  const login = async (email) =>
    (
      await fetch(`${base}/api/admin/login`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json', Origin: base},
        body: JSON.stringify({email, password: 'AdminPass123'}),
      })
    ).headers
      .get('set-cookie')
      .match(/nx_admin=[^;]*/)[0];
  const call = async (method, path, cookie, body) => {
    const headers = {Accept: 'application/json', Origin: base, Cookie: cookie};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(base + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      status: res.status,
      data: await res.text().then((t) => {
        try {
          return JSON.parse(t);
        } catch {
          return t;
        }
      }),
    };
  };

  test.before(async () => {
    if (!/test/i.test(dbUrl.pathname))
      throw new Error("The test database must have 'test' in its name.");
    await mongoose.connect(dbUrl.href);
    await mongoose.connection.dropDatabase();
    await Promise.all(
      Object.values(mongoose.models).map((m) => m.syncIndexes()),
    );
    owner = await User.create({
      name: 'Goal Owner',
      email: 'owner@goals.test',
      passwordHash: await hashPassword('AdminPass123'),
      role: 'admin',
    });
    await User.create({
      name: 'Goal Finance',
      email: 'finance@goals.test',
      passwordHash: await hashPassword('AdminPass123'),
      role: 'admin',
      adminRole: 'finance',
    });
    const running = await categoryService.ensureCategory('Running');
    categoryService.invalidate();
    shoe = await Product.create({
      name: 'Goal Shoe',
      slug: 'goal-shoe',
      category: running._id,
      brand: 'Nexthlon',
      basePrice: 150000,
      mrp: 180000,
      stock: 9,
      image: '/img/favicon.svg',
    });
    const address = {
      fullName: 'Goal Buyer',
      phone: '9876543210',
      line1: '1 Road',
      city: 'Kochi',
      state: 'Kerala',
      pincode: '682001',
    };
    const item = {
      product: shoe._id,
      name: shoe.name,
      slug: shoe.slug,
      price: 150000,
      mrp: 180000,
      quantity: 1,
      lineTotal: 150000,
      status: 'delivered',
    };
    await Order.create({
      orderId: 'NX-2026-960001',
      user: owner._id,
      items: [item],
      address,
      mrpTotal: 180000,
      subtotal: 150000,
      total: 150000,
      paymentMethod: 'razorpay',
      paymentStatus: 'paid',
      orderStatus: 'delivered',
      stockReserved: true,
      statusHistory: [],
    });
    await Order.create({
      orderId: 'NX-2026-960002',
      user: owner._id,
      items: [{...item, status: 'returned', returnReason: 'Too small'}],
      address,
      mrpTotal: 180000,
      subtotal: 150000,
      total: 150000,
      paymentMethod: 'razorpay',
      paymentStatus: 'paid',
      orderStatus: 'delivered',
      stockReserved: true,
      statusHistory: [],
    });
    server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
    ownerCookie = await login('owner@goals.test');
    financeCookie = await login('finance@goals.test');
  });

  test.after(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    await new Promise((r) => server.close(r));
  });

  test('goal: the owner sets it, progress counts paid sales, and the change is audited; finance cannot change it', async () => {
    const month = currentMonth();
    const set = await call('PATCH', `/api/admin/goals/${month}`, ownerCookie, {
      amount: 2000,
    });
    assert.equal(set.status, 200, JSON.stringify(set.data));
    assert.equal(set.data.goal, 200000);
    const progress = await revenueGoalService.progress(month);
    assert.equal(progress.revenue, 300000, 'two paid orders this month');
    assert.equal(progress.reached, true);
    assert.ok(await AuditLog.findOne({action: 'goal.set'}));
    assert.equal(
      (
        await call('PATCH', `/api/admin/goals/${month}`, financeCookie, {
          amount: 1,
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await call('PATCH', `/api/admin/goals/${month}`, ownerCookie, {
          amount: -5,
        })
      ).status,
      400,
    );
  });

  test('returns: the reason is reported with its items and value, and the CSV downloads', async () => {
    const now = new Date();
    const report = await returnReasonsService.report({}, now);
    assert.equal(report.reasons.length, 1);
    assert.equal(report.reasons[0].reason, 'Too small');
    assert.equal(report.reasons[0].items, 1);
    assert.equal(report.reasons[0].value, 150000);
    const csv = await fetch(`${base}/api/admin/reports/returns.csv`, {
      headers: {Cookie: ownerCookie},
    });
    assert.match(await csv.text(), /"Too small"/);
    assert.equal(
      (await call('GET', '/admin/returns-report', ownerCookie)).status,
      200,
    );
  });
}
