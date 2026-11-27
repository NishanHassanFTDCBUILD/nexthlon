require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const Product = require('../models/Product');
const Receipt = require('../models/InventoryAdjustment');
const options = require('../services/inventoryOptionService');
const id = '0123456789abcdef01234567';
const existingId = '1123456789abcdef01234567';
const makeProduct = () =>
  new Product({
    _id: id,
    name: 'Shoe',
    stock: 4,
    variants: [{_id: existingId, size: '5', colour: 'Black', stock: 4}],
  });

function productFixture(t, product) {
  let writes = 0;
  const session = {};
  product.save = async (config) => {
    assert.equal(config.session, session);
    writes++;
    return product;
  };
  t.mock.method(Product, 'findById', () => ({
    session: async (supplied) => {
      assert.equal(supplied, session);
      return product;
    },
  }));
  return {session, writes: () => writes};
}

test('new combinations validate size, color and supported input types', () => {
  assert.deepEqual(options.readCombination({size: ' 7 ', colour: ' White '}), {
    size: '7',
    colour: 'White',
  });
  assert.deepEqual(options.readCombination({size: 'M'}), {
    size: 'M',
    colour: '',
  });
  for (const body of [
    null,
    {},
    {size: []},
    {colour: {$gt: ''}},
    {size: 'x'.repeat(21)},
    {colour: 'x'.repeat(31)},
  ])
    assert.throws(() => options.readCombination(body));
});

test('an existing combination reuses its ID without changing its stock or making another row', async (t) => {
  const product = makeProduct();
  const fixture = productFixture(t, product);
  const result = await options.ensureOption(
    id,
    {size: '5', colour: 'black'},
    fixture.session,
  );
  assert.deepEqual(result, {id: existingId, created: false});
  assert.equal(product.variants.length, 1);
  assert.equal(fixture.writes(), 0);
});

test('new sizes and colors preserve old options and reuse the existing spelling of a color', async (t) => {
  const product = makeProduct();
  const fixture = productFixture(t, product);
  const white = await options.ensureOption(
    id,
    {size: '7', colour: 'White'},
    fixture.session,
  );
  const black = await options.ensureOption(
    id,
    {size: '8', colour: 'black'},
    fixture.session,
  );
  assert.equal(white.created, true);
  assert.equal(black.created, true);
  assert.equal(product.variants[2].colour, 'Black');
  assert.equal(product.variants[0].stock, 4);
  assert.equal(
    product.variants[1].stock,
    0,
    'stock is added by the adjustment inside the same transaction',
  );
  assert.equal(String(product.variants[0]._id), existingId);
});

test('unassigned general stock and incomplete combinations cannot be silently reallocated', async (t) => {
  const product = makeProduct();
  const fixture = productFixture(t, product);
  await assert.rejects(
    options.ensureOption(id, {size: '7', colour: ''}, fixture.session),
    /every row a colour/,
  );
  product.variants = [];
  await assert.rejects(
    options.ensureOption(id, {size: '7', colour: 'White'}, fixture.session),
    /unassigned stock/,
  );
  assert.equal(fixture.writes(), 0);
});

test('creation and restocking use one transaction and a repeated request reuses its receipt', async (t) => {
  const transaction = require('../utils/transaction');
  const inventory = require('../services/inventoryService');
  const AuditLog = require('../models/AuditLog');
  const session = {};
  let receipt = null;
  let creations = 0;
  let additions = 0;
  t.mock.method(transaction, 'supportsTransactions', async () => true);
  t.mock.method(transaction, 'inTransaction', async (work) => work(session));
  t.mock.method(Receipt, 'init', async () => {});
  t.mock.method(Receipt, 'findOne', () => {
    const query = {session: () => query, lean: async () => receipt};
    return query;
  });
  t.mock.method(Receipt, 'create', async (rows, config) => {
    assert.equal(config.session, session);
    receipt = rows[0];
  });
  t.mock.method(
    options,
    'ensureOption',
    async (productId, combination, actualSession) => {
      assert.equal(actualSession, session);
      assert.equal(combination.colour, 'White');
      creations++;
      return {id: existingId, created: true};
    },
  );
  t.mock.method(inventory, 'adjustStock', async (productId, value) => {
    assert.equal(value.session, session);
    assert.equal(value.optionId, existingId);
    additions++;
    return {
      product: {id, name: 'Shoe'},
      option: {id: existingId, label: 'Size 7 · White'},
      before: 0,
      after: 10,
    };
  });
  t.mock.method(AuditLog, 'create', async (rows, config) => {
    assert.equal(config.session, session);
    assert.equal(rows[0].after.optionCreated, true);
  });
  delete require.cache[
    require.resolve('../services/inventoryAdjustmentService')
  ];
  const service = require('../services/inventoryAdjustmentService');
  const value = {
    action: 'add',
    units: 10,
    reason: 'restock',
    requestId: 'new-combination-test-0001',
    combination: {size: '7', colour: 'White'},
  };
  const result = await service.apply({actor: id}, id, value);
  assert.equal(result.optionCreated, true);
  assert.equal((await service.apply({actor: id}, id, value)).replayed, true);
  assert.equal(creations, 1);
  assert.equal(additions, 1);
  await assert.rejects(
    service.apply({actor: id}, id, {
      ...value,
      combination: {size: '5', colour: 'Black'},
    }),
    /different values/,
  );
});
