require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const User = require('../models/User');
const Order = require('../models/Order');
const fit = require('../services/fitProfileService');
const packing = require('../services/packingAssignmentService');
const id = '0123456789abcdef01234567';

test('fit preferences validate enumerations, optional sizes and untrusted values', () => {
  assert.deepEqual(fit.validate({}), {
    sports: [],
    clothing: '',
    shoeSystem: 'UK',
    shoeSize: '',
  });
  assert.deepEqual(
    fit.validate({sports: ['Football', 'Football'], shoeSize: '8.5'}).sports,
    ['Football'],
  );
  for (const body of [
    {sports: 'Football'},
    {sports: ['unknown']},
    {clothing: {$gt: ''}},
    {shoeSize: '0'},
    {shoeSize: '8.2'},
    {shoeSize: '56'},
    {shoeSystem: 'invalid'},
  ])
    assert.throws(() => fit.validate(body));
});

test('saving fit uses the authenticated customer and accepts only preference fields', async (t) => {
  t.mock.method(User, 'findOneAndUpdate', async (filter, update) => {
    assert.equal(filter._id, id);
    assert.equal(filter.role, 'customer');
    assert.deepEqual(Object.keys(update.$set), ['fitProfile']);
    return {_id: id};
  });
  await fit.update(id, {
    sports: ['Running'],
    userId: 'someone-else',
    role: 'admin',
  });
});

test('packing claims compare ownership atomically and releases require the same staff member', async (t) => {
  const actor = {_id: id, name: 'Packing staff'};
  let filter;
  t.mock.method(Order, 'findOneAndUpdate', (criteria, update) => {
    filter = criteria;
    assert.ok(criteria.orderStatus.$in.includes('confirmed'));
    return {select: async () => ({...update.$set})};
  });
  await packing.change('NX-2026-000001', actor, 'claim');
  assert.deepEqual(filter.$or, [{packingOwner: null}, {packingOwner: id}]);
  await packing.change('NX-2026-000001', actor, 'release');
  assert.equal(filter.packingOwner, id);
  t.mock.method(Order, 'findOneAndUpdate', () => ({select: async () => null}));
  await assert.rejects(
    packing.change('NX-2026-000001', actor, 'claim'),
    /assigned to someone else/,
  );
  await assert.rejects(
    packing.change('NX-2026-000001', actor, 'force'),
    /Choose claim or release/,
  );
});

test('customer profile page and API work through customer JWT authentication', async (t) => {
  const user = new User({
    _id: id,
    name: 'Test Athlete',
    email: 'athlete@example.test',
    role: 'customer',
  });
  t.mock.method(User, 'findById', async () => user);
  t.mock.method(
    require('../services/cartService'),
    'countItems',
    async () => 0,
  );
  t.mock.method(
    require('../services/wishlistService'),
    'productIds',
    async () => [],
  );
  t.mock.method(
    require('../services/categoryService'),
    'listedCategories',
    async () => [],
  );
  const app = require('../app');
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const cookie =
    'nx_token=' + require('../services/tokenService').signToken(user);
  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/account/profile`,
    {headers: {Cookie: cookie}},
  );
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Sports &amp; fit/);
  assert.match(html, /Test Athlete/);
  assert.match(html, /data-fit-profile/);
});
