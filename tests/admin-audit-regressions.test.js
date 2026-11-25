require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Product = require('../models/Product');
const Receipt = require('../models/InventoryAdjustment');
const AuditLog = require('../models/AuditLog');
const inventory = require('../services/inventoryService');
const transaction = require('../utils/transaction');
const productId = '0123456789abcdef01234567';
const actor = '1123456789abcdef01234567';
const value = {
  action: 'add',
  units: 4,
  reason: 'restock',
  note: '',
  requestId: 'test-stock-request-0001',
};

function adjustment(t, supported = true) {
  const receipts = new Map();
  t.mock.method(Receipt, 'init', async () => {});
  const session = {};
  let stock = 3;
  t.mock.method(transaction, 'supportsTransactions', async () => supported);
  t.mock.method(transaction, 'inTransaction', async (work) => work(session));
  t.mock.method(Receipt, 'findOne', (key) => {
    const query = {
      lean: async () => receipts.get(key.requestId) || null,
      session: () => query,
    };
    return query;
  });
  t.mock.method(Receipt, 'create', async (rows, options) => {
    assert.equal(options.session, session);
    receipts.set(rows[0].requestId, rows[0]);
  });
  const writes = t.mock.method(inventory, 'adjustStock', async (id, input) => {
    assert.equal(input.session, session);
    const before = stock;
    stock += input.units;
    return {before, after: stock, product: {id, name: 'Shoe', stock}};
  });
  const audits = t.mock.method(AuditLog, 'create', async (rows, options) => {
    assert.equal(options.session, session);
    assert.equal(rows[0].after.requestId, value.requestId);
  });
  delete require.cache[
    require.resolve('../services/inventoryAdjustmentService')
  ];
  return {
    service: require('../services/inventoryAdjustmentService'),
    writes,
    audits,
    session,
    stock: () => stock,
  };
}

test('stock, receipt and audit share a transaction; repeated requests do not add twice', async (t) => {
  const fixture = adjustment(t);
  const first = await fixture.service.apply({actor}, productId, value);
  const second = await fixture.service.apply({actor}, productId, value);
  assert.equal(first.after, 7);
  assert.equal(second.replayed, true);
  assert.equal(fixture.stock(), 7);
  assert.equal(fixture.writes.mock.callCount(), 1);
  assert.equal(fixture.audits.mock.callCount(), 1);
  await assert.rejects(
    fixture.service.apply({actor}, productId, {...value, units: 6}),
    /different values/,
  );
});

test('an uncertain transaction response is reconciled using its committed receipt', async (t) => {
  const fixture = adjustment(t);
  transaction.inTransaction.mock.mockImplementation(async (work) => {
    await work(fixture.session);
    throw new Error('Commit reply lost');
  });
  delete require.cache[
    require.resolve('../services/inventoryAdjustmentService')
  ];
  const result = await require('../services/inventoryAdjustmentService').apply(
    {actor},
    productId,
    value,
  );
  assert.equal(result.replayed, true);
  assert.equal(fixture.stock(), 7);
});

test('standalone databases reject a keyed adjustment before writing any stock', async (t) => {
  const fixture = adjustment(t, false);
  await assert.rejects(
    fixture.service.apply({actor}, productId, value),
    /replica set or Atlas/,
  );
  assert.equal(fixture.writes.mock.callCount(), 0);
  assert.equal(fixture.audits.mock.callCount(), 0);
});

test('an exact stock count rejects an old browser value before updating', async (t) => {
  t.mock.method(Product, 'findById', () => ({
    select: () => ({
      lean: async () => ({
        _id: productId,
        name: 'Shoe',
        stock: 2,
        variants: [],
      }),
    }),
  }));
  const write = t.mock.method(Product, 'findOneAndUpdate', () =>
    assert.fail('stale count must not write'),
  );
  await assert.rejects(
    inventory.adjustStock(productId, {
      action: 'count',
      units: 9,
      expectedStock: 3,
    }),
    /Stock changed/,
  );
  assert.equal(write.mock.callCount(), 0);
});

test('an exact count also compares stock atomically when checkout happens after the read', async (t) => {
  t.mock.method(Product, 'findById', () => ({
    select: () => ({
      lean: async () => ({
        _id: productId,
        name: 'Shoe',
        stock: 3,
        variants: [],
      }),
    }),
  }));
  t.mock.method(Product, 'findOneAndUpdate', (filter) => {
    assert.equal(filter.stock, 3);
    return {populate: async () => null};
  });
  await assert.rejects(
    inventory.adjustStock(productId, {
      action: 'count',
      units: 9,
      expectedStock: 3,
    }),
    /Stock changed while saving/,
  );
});

test('product editing refuses a stale stock snapshot without saving', async (t) => {
  const product = new Product({
    _id: productId,
    name: 'Shoe',
    stock: 2,
    variants: [],
  });
  t.mock.method(Product, 'findById', () => ({populate: async () => product}));
  const service = require('../services/adminProductService');
  const stale = service.stockSnapshot({...product.toObject(), stock: 3});
  await assert.rejects(
    service.updateProduct(productId, {
      value: {},
      errors: {},
      body: {stockSnapshot: stale},
      files: [],
    }),
    /changed since/,
  );
});

test('unknown stored admin roles never inherit owner privileges', () => {
  const {roleOf, can} = require('../utils/permissions');
  assert.equal(roleOf({role: 'admin', adminRole: 'owenr'}), null);
  assert.equal(can(roleOf({role: 'admin', adminRole: 'owenr'}), 'read'), false);
  assert.equal(roleOf({role: 'admin'}), 'owner');
  assert.equal(roleOf({role: 'admin', adminRole: ''}), 'owner');
  const legacy = new (require('../models/User'))({role: 'admin'});
  assert.equal(legacy.adminRole, '');
  assert.equal(can(roleOf(legacy), 'read'), true);
});

test('failed audit writes enqueue the same sanitized identity for durable delivery', async (t) => {
  t.mock.method(AuditLog, 'create', async () => {
    throw new Error('Temporary write failure');
  });
  const queued = t.mock.method(
    require('../jobs/queue'),
    'enqueue',
    async (type, entry, options) => {
      assert.equal(type, 'audit.write');
      assert.ok(mongoose.isValidObjectId(entry._id));
      assert.equal(options.dedupeKey, `audit:${entry._id}`);
      assert.equal(entry.after.password, undefined);
      assert.equal(entry.ip, '127.0.x.x');
    },
  );
  await require('../services/auditService').record({
    actor,
    action: 'test.changed',
    ip: '127.0.0.1',
    after: {password: 'never store', stock: 2},
  });
  assert.equal(queued.mock.callCount(), 1);
});

test('restricted admin ledger HTML pages deny packing staff before querying financial data', async (t) => {
  const auth = require('../middleware/auth');
  t.mock.method(auth, 'adminPage', (req, res, next) => {
    req.user = {_id: actor, role: 'admin', adminRole: 'packing'};
    next();
  });
  delete require.cache[require.resolve('../routes/adminPageRoutes')];
  const app = require('express')();
  app.use(require('../routes/adminPageRoutes'));
  app.use((error, req, res, _next) =>
    res
      .status(error.status || error.statusCode || 500)
      .json({message: error.message}),
  );
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  for (const path of [
    '/transactions',
    '/transactions/' + productId,
    '/products/new',
    '/settings',
  ]) {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}${path}`,
    );
    assert.equal(response.status, 403, path + ': ' + (await response.text()));
  }
});

test('removed activity and background-work admin pages stay unavailable', async (t) => {
  const auth = require('../middleware/auth');
  t.mock.method(auth, 'adminPage', (req, res, next) => {
    req.user = {_id: actor, role: 'admin', adminRole: 'owner'};
    next();
  });
  delete require.cache[require.resolve('../routes/adminPageRoutes')];
  const app = require('express')();
  app.use(require('../routes/adminPageRoutes'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  for (const path of ['/audit', '/jobs']) {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}${path}`,
    );
    assert.equal(response.status, 404, path);
  }
});
