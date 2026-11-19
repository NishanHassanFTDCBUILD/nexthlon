// Step 9: the sales breakdown against real orders (paid only, by category and state).
require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');

if (!process.env.TEST_MONGODB_URI) {
  test(
    'sales breakdown database tests (set TEST_MONGODB_URI to run them)',
    {skip: true},
    () => {},
  );
} else {
  const mongoose = require('mongoose');
  const app = require('../app');
  const User = require('../models/User');
  const Product = require('../models/Product');
  const Order = require('../models/Order');
  const categoryService = require('../services/categoryService');
  const salesBreakdownService = require('../services/salesBreakdownService');
  const {hashPassword} = require('../services/authService');

  const dbUrl = new URL(process.env.TEST_MONGODB_URI);
  dbUrl.pathname = `${dbUrl.pathname.replace(/\/$/, '')}_breakdown`;
  let server;
  let base;
  let ownerCookie;
  let packingCookie;

  const call = async (path, cookie) => {
    const res = await fetch(base + path, {
      headers: {Accept: 'application/json,text/html', Cookie: cookie},
      redirect: 'manual',
    });
    const type = res.headers.get('content-type') || '';
    return {
      status: res.status,
      data: type.includes('json') ? await res.json() : await res.text(),
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
    const owner = await User.create({
      name: 'Breakdown Owner',
      email: 'owner@breakdown.test',
      passwordHash: await hashPassword('AdminPass123'),
      role: 'admin',
    });
    await User.create({
      name: 'Breakdown Packing',
      email: 'packing@breakdown.test',
      passwordHash: await hashPassword('AdminPass123'),
      role: 'admin',
      adminRole: 'packing',
    });
    const running = await categoryService.ensureCategory('Running');
    categoryService.invalidate();
    const shoe = await Product.create({
      name: 'Breakdown Shoe',
      slug: 'breakdown-shoe',
      category: running._id,
      brand: 'Nexthlon',
      basePrice: 100000,
      mrp: 120000,
      stock: 9,
      image: '/img/favicon.svg',
    });
    const item = {
      product: shoe._id,
      name: shoe.name,
      slug: shoe.slug,
      price: 100000,
      mrp: 120000,
      quantity: 2,
      lineTotal: 200000,
      status: 'delivered',
    };
    const address = {
      fullName: 'Pat',
      phone: '9876543210',
      line1: '1 Road',
      city: 'Kochi',
      state: 'Kerala',
      pincode: '682001',
    };
    await Order.create({
      orderId: 'NX-2026-950001',
      user: owner._id,
      items: [item],
      address,
      mrpTotal: 240000,
      subtotal: 200000,
      total: 200000,
      paymentMethod: 'razorpay',
      paymentStatus: 'paid',
      orderStatus: 'delivered',
      stockReserved: true,
      statusHistory: [],
    });
    // A cancelled order must not count.
    await Order.create({
      orderId: 'NX-2026-950002',
      user: owner._id,
      items: [{...item, status: 'cancelled'}],
      address,
      mrpTotal: 240000,
      subtotal: 200000,
      total: 200000,
      paymentMethod: 'razorpay',
      paymentStatus: 'refunded',
      orderStatus: 'cancelled',
      stockReserved: true,
      statusHistory: [],
    });
    server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
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
    ownerCookie = await login('owner@breakdown.test');
    packingCookie = await login('packing@breakdown.test');
  });

  test.after(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    await new Promise((r) => server.close(r));
  });

  test('breakdown: paid sales by category and state, with cancelled orders left out', async () => {
    const now = new Date();
    const data = await salesBreakdownService.breakdown({}, now);
    assert.equal(data.categories.length, 1);
    assert.equal(data.categories[0].name, 'Running');
    assert.equal(data.categories[0].units, 2);
    assert.equal(data.categories[0].revenue, 200000);
    assert.equal(data.states[0].name, 'Kerala');
    assert.equal(data.states[0].orders, 1);
  });

  test('breakdown: the page and CSV are for the reports permission only', async () => {
    const page = await call('/admin/sales-breakdown', ownerCookie);
    assert.equal(page.status, 200);
    assert.match(page.data, /By category/);
    assert.equal(
      (await call('/admin/sales-breakdown', packingCookie)).status,
      403,
    );
    const csv = await fetch(`${base}/api/admin/reports/breakdown.csv`, {
      headers: {Cookie: ownerCookie},
    });
    assert.equal(csv.status, 200);
    assert.match(await csv.text(), /"Running"/);
  });
}
