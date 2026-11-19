// Admin roles: what each role may do (utils/permissions.js), enforced on the API and the pages,
// staff accounts (add, change role, turn off), and that every change is audit-logged.
require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  permissionFor,
  can,
  PERMISSIONS,
  ROLES,
} = require('../utils/permissions');

// ---------- Rules that need no database ----------

test('roles: each role gets what its job needs and nothing it should not have', () => {
  assert.equal(can('owner', 'staff.manage'), true);
  assert.equal(can('owner', null), true, 'the owner may use owner-only routes');
  assert.equal(
    can('manager', 'staff.manage'),
    false,
    'only the owner manages staff',
  );
  assert.equal(can('manager', 'products.write'), true);
  assert.equal(can('packing', 'orders.ship'), true);
  assert.equal(can('packing', 'refunds.write'), false);
  assert.equal(can('packing', 'products.write'), false);
  assert.equal(can('catalogue', 'products.write'), true);
  assert.equal(can('catalogue', 'orders.ship'), false);
  assert.equal(can('support', 'support.write'), true);
  assert.equal(can('support', 'refunds.write'), false);
  assert.equal(can('finance', 'refunds.write'), true);
  assert.equal(can('finance', 'products.write'), false);
  assert.equal(can('finance', 'audit.read'), false);
  assert.equal(
    can('unknown-role', 'read'),
    false,
    'an unknown role gets nothing',
  );
  for (const role of ROLES) assert.ok(PERMISSIONS[role], `${role} is defined`);
});

test('routes: a request maps to the permission it needs', () => {
  assert.equal(permissionFor('GET', '/orders'), 'read');
  assert.equal(permissionFor('GET', '/staff'), 'staff.manage');
  assert.equal(permissionFor('GET', '/audit'), 'audit.read');
  assert.equal(permissionFor('POST', '/orders/NX-1/refunds'), 'refunds.write');
  assert.equal(permissionFor('POST', '/orders/NX-1/shipments'), 'orders.ship');
  assert.equal(permissionFor('PATCH', '/orders/NX-1/status'), 'orders.write');
  assert.equal(permissionFor('PATCH', '/products/abc'), 'products.write');
  assert.equal(permissionFor('PATCH', '/staff/abc/role'), 'staff.manage');
  assert.equal(
    permissionFor('POST', '/mystery-route'),
    null,
    'unlisted writes are owner only',
  );
});

test('routes: every write route in the admin API has a permission', () => {
  // A new write route that nobody mapped would be owner-only by default; this makes that visible.
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'routes', 'adminRoutes.js'),
    'utf8',
  );
  const writes = [
    ...source.matchAll(/router\.(post|patch|delete)\(\s*'([^']+)'/g),
  ].map((m) => ({method: m[1].toUpperCase(), route: m[2]}));
  assert.ok(writes.length > 40, 'the scan found the write routes');
  const unmapped = writes.filter(
    ({method, route}) =>
      permissionFor(method, route.replace(/:[A-Za-z]+/g, 'x')) === null,
  );
  // Only the explicitly owner-only routes may be unmapped. Currently there are none.
  assert.deepEqual(
    unmapped.map((w) => `${w.method} ${w.route}`),
    [],
    'every write route needs a permission in utils/permissions.js',
  );
});

// ---------- Through the API, with a database ----------

if (!process.env.TEST_MONGODB_URI) {
  test(
    'admin role API tests (set TEST_MONGODB_URI to run them)',
    {skip: true},
    () => {},
  );
  return;
}

const mongoose = require('mongoose');
const app = require('../app');
const User = require('../models/User');
const Product = require('../models/Product');
const AuditLog = require('../models/AuditLog');
const categoryService = require('../services/categoryService');
const {hashPassword} = require('../services/authService');

const dbUrl = new URL(process.env.TEST_MONGODB_URI);
dbUrl.pathname = `${dbUrl.pathname.replace(/\/$/, '')}_roles`;

let server;
let base;
let owner;
let ownerCookie;
let packingCookie;
let financeCookie;
let managerCookie;
let shoe;

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

const PASSWORD = 'RoleTest2026pass';

async function staffUser(email, adminRole) {
  return User.create({
    name: `${adminRole} person`,
    email,
    passwordHash: await hashPassword(PASSWORD),
    role: 'admin',
    adminRole,
  });
}

async function signIn(email, password = PASSWORD) {
  return (await call('POST', '/api/admin/login', {body: {email, password}}))
    .cookie;
}

let handPassword = '';

test.before(async () => {
  if (!/test/i.test(dbUrl.pathname))
    throw new Error("The test database must have 'test' in its name.");
  await mongoose.connect(dbUrl.href);
  await mongoose.connection.dropDatabase();
  await Promise.all(
    Object.values(mongoose.models).map((model) => model.syncIndexes()),
  );
  owner = await staffUser('owner@roles.test', 'owner');
  await staffUser('manager@roles.test', 'manager');
  await staffUser('packing@roles.test', 'packing');
  await staffUser('finance@roles.test', 'finance');
  const running = await categoryService.ensureCategory('Running');
  categoryService.invalidate();
  shoe = await Product.create({
    name: 'Role Shoe',
    slug: 'role-shoe',
    category: running._id,
    brand: 'Nexthlon',
    basePrice: 300000,
    mrp: 400000,
    stock: 3,
    image: '/img/favicon.svg',
  });
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  ownerCookie = await signIn('owner@roles.test');
  managerCookie = await signIn('manager@roles.test');
  packingCookie = await signIn('packing@roles.test');
  financeCookie = await signIn('finance@roles.test');
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  await new Promise((resolve) => server.close(resolve));
});

test('roles: the API refuses what a role may not do, and says which permission is missing', async () => {
  const lookup = await call('GET', '/api/admin/orders', {
    cookie: packingCookie,
  });
  assert.equal(lookup.status, 200, 'every staff role can read the console');

  const edit = await call('PATCH', `/api/admin/products/${shoe._id}/listing`, {
    cookie: packingCookie,
    body: {isListed: false},
  });
  assert.equal(edit.status, 403);
  assert.equal(edit.data.errors.permission, 'products.write');

  const refund = await call('POST', '/api/admin/orders/NX-0/refunds', {
    cookie: packingCookie,
    body: {},
  });
  assert.equal(refund.status, 403, 'packing cannot refund');

  const financeRefund = await call('POST', '/api/admin/orders/NX-0/refunds', {
    cookie: financeCookie,
    body: {},
  });
  assert.notEqual(financeRefund.status, 403, 'finance may refund');

  const productEdit = await call(
    'PATCH',
    `/api/admin/products/${shoe._id}/listing`,
    {cookie: financeCookie, body: {isListed: false}},
  );
  assert.equal(productEdit.status, 403, 'finance cannot change products');
});

test('roles: the sidebar and the pages only show what the role may open', async () => {
  const packing = await call('GET', '/admin/dashboard', {
    cookie: packingCookie,
  });
  assert.equal(packing.status, 200);
  assert.doesNotMatch(packing.data, /data-nav-link="staff"/);
  assert.doesNotMatch(packing.data, /data-nav-link="audit"/);
  assert.match(packing.data, /data-nav-link="orders"/);

  const ownerPage = await call('GET', '/admin/staff', {cookie: ownerCookie});
  assert.equal(ownerPage.status, 200);
  assert.match(ownerPage.data, /Add a staff member/);

  assert.equal(
    (await call('GET', '/admin/staff', {cookie: managerCookie})).status,
    403,
    'the manager cannot open staff',
  );
  assert.equal(
    (await call('GET', '/admin/audit', {cookie: financeCookie})).status,
    403,
    'finance cannot open the audit log',
  );
});

test('staff: the owner adds an account; the password is shown once; the manager cannot', async () => {
  const denied = await call('POST', '/api/admin/staff', {
    cookie: managerCookie,
    body: {name: 'New Hand', email: 'hand@roles.test', role: 'packing'},
  });
  assert.equal(denied.status, 403);

  const made = await call('POST', '/api/admin/staff', {
    cookie: ownerCookie,
    body: {name: 'New Hand', email: 'hand@roles.test', role: 'packing'},
  });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  assert.equal(made.data.staff.role, 'packing');
  assert.ok(made.data.temporaryPassword.length >= 12);
  handPassword = made.data.temporaryPassword;
  assert.equal(
    (
      await call('POST', '/api/admin/staff', {
        cookie: ownerCookie,
        body: {name: 'Again', email: 'hand@roles.test', role: 'packing'},
      })
    ).status,
    409,
    'the same email cannot be added twice',
  );
  // The password is not in the audit log.
  const audit = await AuditLog.findOne({action: 'staff.created'}).lean();
  assert.ok(audit);
  assert.equal(
    JSON.stringify(audit).includes(made.data.temporaryPassword),
    false,
  );
});

test('staff: roles change at once; an owner cannot lock the store or change themselves', async () => {
  const hand = await User.findOne({email: 'hand@roles.test'});
  const changed = await call('PATCH', `/api/admin/staff/${hand._id}/role`, {
    cookie: ownerCookie,
    body: {role: 'catalogue'},
  });
  assert.equal(changed.status, 200);
  assert.equal((await User.findById(hand._id).lean()).adminRole, 'catalogue');
  assert.ok(await AuditLog.findOne({action: 'staff.role_changed'}));

  const self = await call('PATCH', `/api/admin/staff/${owner._id}/role`, {
    cookie: ownerCookie,
    body: {role: 'manager'},
  });
  assert.equal(self.status, 409, 'you cannot change your own access');

  // Only one active owner exists, so the owner cannot be demoted by another owner either.
  assert.equal(
    (
      await call('PATCH', `/api/admin/staff/${owner._id}/role`, {
        cookie: managerCookie,
        body: {role: 'manager'},
      })
    ).status,
    403,
  );
});

test('staff: turning access off signs the person out everywhere, and on again lets them back in', async () => {
  const hand = await User.findOne({email: 'hand@roles.test'});
  const handCookie = await signIn('hand@roles.test', handPassword);
  assert.ok(handCookie, 'the new account can sign in');

  const off = await call('PATCH', `/api/admin/staff/${hand._id}/active`, {
    cookie: ownerCookie,
    body: {active: false},
  });
  assert.equal(off.status, 200);
  assert.equal(
    (await call('GET', '/api/admin/orders', {cookie: handCookie})).status,
    401,
    'their existing session stops working',
  );
  assert.equal(
    await signIn('hand@roles.test', handPassword),
    null,
    'and they cannot sign in',
  );
  assert.ok(await AuditLog.findOne({action: 'staff.disabled'}));

  await call('PATCH', `/api/admin/staff/${hand._id}/active`, {
    cookie: ownerCookie,
    body: {active: true},
  });
  assert.ok(
    await signIn('hand@roles.test', handPassword),
    'turned back on, they sign in again',
  );
});

test('audit: each record has its own history, filtered by target', async () => {
  await call('PATCH', `/api/admin/products/${shoe._id}/listing`, {
    cookie: ownerCookie,
    body: {isListed: false},
  });
  const api = await call('GET', `/api/admin/audit?target=product:${shoe._id}`, {
    cookie: ownerCookie,
  });
  assert.equal(api.status, 200);
  assert.ok(api.data.entries.length >= 1);
  assert.ok(api.data.entries.every((e) => e.target === `product:${shoe._id}`));

  const page = await call('GET', `/admin/audit?target=product:${shoe._id}`, {
    cookie: ownerCookie,
  });
  assert.equal(page.status, 200);
  assert.match(page.data, /Product unlisted/);
  assert.match(page.data, new RegExp(`product:${shoe._id}`));
});
