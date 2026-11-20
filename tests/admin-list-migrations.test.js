// Test settings (no .env needed, as in CI).
require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const Category = require('../models/Category');
const Coupon = require('../models/Coupon');
const CouponRedemption = require('../models/CouponRedemption');
const Deal = require('../models/Deal');
const Product = require('../models/Product');
const Order = require('../models/Order');
const User = require('../models/User');
const StockAlert = require('../models/StockAlert');
const categories = require('../services/adminCategoryService');
const coupons = require('../services/adminCouponService');
const deals = require('../services/dealService');
const orders = require('../services/adminOrderService');
const inventory = require('../services/inventoryService');
const ledger = require('../services/ledgerService');

function stubFind(t, Model, rows = []) {
  const calls = [];
  t.mock.method(Model, 'find', (filter) => {
    const call = {filter};
    calls.push(call);
    const chain = {};
    for (const key of ['sort', 'skip', 'limit', 'select', 'populate'])
      chain[key] = (value) => {
        call[key] = value;
        return chain;
      };
    chain.lean = async () => rows;
    chain.distinct = async () => [];
    return chain;
  });
  t.mock.method(Model, 'countDocuments', async () => 51);
  return calls;
}

for (const [name, Model, service, fn, status, sort] of [
  ['categories', Category, categories, 'listCategories', 'hidden', 'offer'],
  ['coupons', Coupon, coupons, 'listCoupons', 'disabled', 'used_desc'],
  ['deals', Deal, deals, 'listDeals', 'live', 'percent'],
  ['orders', Order, orders, 'listOrders', 'confirmed', 'amount_asc'],
  ['returns', Order, orders, 'listReturns', 'approved', 'oldest'],
]) {
  test(`${name}: list migration applies database paging and a stable sort, and preserves filters`, async (t) => {
    const calls = stubFind(t, Model);
    if (Model !== Product) stubFind(t, Product);
    if (Model !== User) stubFind(t, User);
    t.mock.method(Order, 'aggregate', async () => []);
    t.mock.method(CouponRedemption, 'aggregate', async () => []);
    const result = await service[fn]({
      q: 'test.*',
      status,
      sort,
      page: '2',
      limit: '50',
    });
    const page = calls.find((call) => call.skip !== undefined);
    assert.equal(page.skip, 50);
    assert.equal(page.limit, 50);
    assert.ok(Object.hasOwn(page.sort, '_id'));
    assert.equal(result.filters.status, status);
    assert.equal(result.filters.sort, sort);
    assert.equal(result.pagination.pages, 2);
    assert.equal(result.pagination.total, 51);
    assert.ok(result.chips.some((chip) => chip.key === 'q'));
    assert.ok(result.sorts[sort]);
  });
}

test('inventory: aggregation receives a typed category id and all paging/sort stages before lookups', async (t) => {
  const pipelines = [];
  t.mock.method(Product, 'aggregate', async (pipeline) => {
    pipelines.push(pipeline);
    return [];
  });
  t.mock.method(Product, 'countDocuments', async () => 51);
  t.mock.method(StockAlert, 'aggregate', async () => []);
  stubFind(t, Category);
  const id = '0123456789abcdef01234567';
  const result = await inventory.listInventory({
    category: id,
    sort: 'stock_desc',
    page: '2',
    limit: '50',
  });
  const pipeline = pipelines.find((stages) => stages[0].$match);
  assert.equal(pipeline[0].$match.category.toHexString(), id);
  assert.equal(pipeline.find((stage) => stage.$skip).$skip, 50);
  assert.equal(pipeline.find((stage) => stage.$limit).$limit, 50);
  assert.equal(pipeline.find((stage) => stage.$sort).$sort.stock, -1);
  assert.equal(result.pagination.pages, 2);
});

for (const fn of ['listTransactions', 'listRefunds']) {
  test(`ledger ${fn}: amount sort and pagination run in the facet on the database`, async (t) => {
    let pipeline;
    t.mock.method(Order, 'aggregate', async (stages) => {
      pipeline = stages;
      return [{rows: [], totals: [], byStatus: [], count: [{n: 51}]}];
    });
    const result = await ledger[fn]({
      sort: 'amount_asc',
      page: '2',
      limit: '50',
    });
    const rows = pipeline.find((stage) => stage.$facet).$facet.rows;
    assert.equal(rows[0].$sort.amount, 1);
    assert.ok(Object.hasOwn(rows[0].$sort, 'id'));
    assert.equal(rows[1].$skip, 50);
    assert.equal(rows[2].$limit, 50);
    assert.equal(result.pagination.pages, 2);
  });
}
