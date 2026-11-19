// Step 9 slice: return rules (automatic approval up to a limit, owner-only approval above one) and the
// goal pace alert.
require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const {ownerApprovalNeeded, autoApprovable} = require('../utils/returnRules');

test('return rules: a refund above the owner limit needs the owner; a limit of 0 is off', () => {
  assert.equal(ownerApprovalNeeded(150000, 100000), true);
  assert.equal(ownerApprovalNeeded(100000, 100000), false);
  assert.equal(ownerApprovalNeeded(150000, 0), false);
});

test('return rules: automatic approval needs a positive refund within the limit and under the owner limit', () => {
  const rules = {autoApproveUnder: 200000, ownerApprovalAbove: 100000};
  assert.equal(autoApprovable(150000, rules), false, 'owner must approve it');
  assert.equal(autoApprovable(90000, rules), true);
  assert.equal(autoApprovable(0, rules), false);
  assert.equal(
    autoApprovable(90000, {autoApproveUnder: 0, ownerApprovalAbove: 0}),
    false,
    'automatic approval is off',
  );
});

if (!process.env.TEST_MONGODB_URI) {
  test(
    'return rules and goal pace tests (set TEST_MONGODB_URI to run them)',
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
  const adminOrderService = require('../services/adminOrderService');
  const {hashPassword} = require('../services/authService');

  const dbUrl = new URL(process.env.TEST_MONGODB_URI);
  dbUrl.pathname = `${dbUrl.pathname.replace(/\/$/, '')}_returnrules`;
  let server;
  let base;
  let owner;
  let ownerCookie;
  let financeCookie;
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

  // A delivered-and-asked-for return of one shoe worth ₹1,500 (150000 paise).
  let counter = 0;
  const askedReturn = async () => {
    counter += 1;
    const item = {
      product: shoe._id,
      name: shoe.name,
      slug: shoe.slug,
      price: 150000,
      mrp: 180000,
      quantity: 1,
      lineTotal: 150000,
      status: 'return_requested',
      returnReason: 'Too small',
    };
    return Order.create({
      orderId: `NX-2026-98000${counter}`,
      user: owner._id,
      items: [item],
      address: {
        fullName: 'Rules Buyer',
        phone: '9876543210',
        line1: '1 Road',
        city: 'Kochi',
        state: 'Kerala',
        pincode: '682001',
      },
      mrpTotal: 180000,
      subtotal: 150000,
      total: 150000,
      paymentMethod: 'razorpay',
      paymentStatus: 'paid',
      orderStatus: 'return_requested',
      stockReserved: true,
      statusHistory: [],
    });
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
      name: 'Rules Owner',
      email: 'owner@rules.test',
      passwordHash: await hashPassword('AdminPass123'),
      role: 'admin',
    });
    await User.create({
      name: 'Rules Finance',
      email: 'finance@rules.test',
      passwordHash: await hashPassword('AdminPass123'),
      role: 'admin',
      adminRole: 'finance',
    });
    const running = await categoryService.ensureCategory('Running');
    categoryService.invalidate();
    shoe = await Product.create({
      name: 'Rules Shoe',
      slug: 'rules-shoe',
      category: running._id,
      brand: 'Nexthlon',
      basePrice: 150000,
      mrp: 180000,
      stock: 9,
      image: '/img/favicon.svg',
    });
    server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
    ownerCookie = await login('owner@rules.test');
    financeCookie = await login('finance@rules.test');
  });

  test.after(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    await new Promise((r) => server.close(r));
  });

  test('rules: the owner saves both limits and the change is audited; finance cannot; bad combinations are refused', async () => {
    const saved = await call('PATCH', '/api/admin/returns/rules', ownerCookie, {
      autoApproveRupees: 2000,
      ownerApproveRupees: 5000,
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    assert.deepEqual(saved.data.rules, {
      autoApproveUnder: 200000,
      ownerApprovalAbove: 500000,
    });
    assert.ok(await AuditLog.findOne({action: 'returns.rules'}));
    assert.equal(
      (
        await call('PATCH', '/api/admin/returns/rules', financeCookie, {
          autoApproveRupees: 1,
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await call('PATCH', '/api/admin/returns/rules', ownerCookie, {
          autoApproveRupees: 6000,
          ownerApproveRupees: 5000,
        })
      ).status,
      400,
      'automatic approval cannot go above the owner limit',
    );
    assert.equal(
      (
        await call('PATCH', '/api/admin/returns/rules', ownerCookie, {
          autoApproveRupees: -5,
        })
      ).status,
      400,
    );
  });

  test('auto-approve: a return within the limit is approved at once and audited', async () => {
    const order = await askedReturn();
    const approved = await adminOrderService.tryAutoApprove(order);
    assert.ok(approved, 'approved');
    const fresh = await Order.findById(order._id).lean();
    assert.equal(fresh.orderStatus, 'returned');
    assert.equal(fresh.returnDecision.status, 'approved');
    assert.ok(
      await AuditLog.findOne({
        action: 'return.auto_approved',
        target: `order:${order.orderId}`,
      }),
    );
  });

  test('auto-approve: a return above the automatic limit waits for the team', async () => {
    await call('PATCH', '/api/admin/returns/rules', ownerCookie, {
      autoApproveRupees: 1000,
      ownerApproveRupees: 5000,
    });
    const order = await askedReturn();
    assert.equal(await adminOrderService.tryAutoApprove(order), null);
    assert.equal(
      (await Order.findById(order._id).lean()).orderStatus,
      'return_requested',
    );
  });

  test('owner limit: finance cannot approve a refund above it; the owner can', async () => {
    await call('PATCH', '/api/admin/returns/rules', ownerCookie, {
      autoApproveRupees: 0,
      ownerApproveRupees: 1000,
    });
    const order = await askedReturn();
    const refused = await call(
      'POST',
      `/api/admin/returns/${order.orderId}/decision`,
      financeCookie,
      {decision: 'approve'},
    );
    assert.equal(refused.status, 403, JSON.stringify(refused.data));
    assert.equal(
      (await Order.findById(order._id).lean()).orderStatus,
      'return_requested',
      'nothing changed',
    );
    const allowed = await call(
      'POST',
      `/api/admin/returns/${order.orderId}/decision`,
      ownerCookie,
      {decision: 'approve'},
    );
    assert.equal(allowed.status, 200, JSON.stringify(allowed.data));
    assert.equal(
      (await Order.findById(order._id).lean()).returnDecision.status,
      'approved',
    );
  });

  test('pace: behind in the middle of a month, missed once the month is over, reached when met', async () => {
    await revenueGoalService.setGoal('2026-12', 1000000);
    const middle = await revenueGoalService.progress(
      '2026-12',
      new Date('2026-12-15T06:00:00Z'),
    );
    assert.equal(middle.pace, 'behind');
    assert.ok(middle.expectedNow > 0);

    await revenueGoalService.setGoal('2020-01', 1000);
    const over = await revenueGoalService.progress('2020-01');
    assert.equal(over.pace, 'missed');

    const none = await revenueGoalService.progress('2020-02');
    assert.equal(none.pace, null, 'no goal, no pace');
  });
}
