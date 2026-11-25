const test = require('node:test');
const assert = require('node:assert/strict');
const {parseCsv} = require('../utils/parseCsv');
const {HttpError} = require('../utils/http');
const Product = require('../models/Product');
const InventoryBatch = require('../models/InventoryBatch');
const imports = require('../services/inventoryImportService');

const productId = '0123456789abcdef01234567';
const optionId = '1123456789abcdef01234567';
const actor = '2123456789abcdef01234567';
const batchId = '3123456789abcdef01234567';
const row = {productId, units: '4', reason: 'restock', note: 'Test delivery'};

test('CSV accepts BOM, quoted commas, multiline notes, escaped quotes and CRLF', () => {
  assert.deepEqual(
    parseCsv('\uFEFFproductId,note\r\n123,"a,b\n""quoted"""\r\n'),
    [
      ['productId', 'note'],
      ['123', 'a,b\n"quoted"'],
    ],
  );
});

test('CSV rejects broken quotes, oversized input, too many rows and unexpected headers', () => {
  for (const input of ['a,"unclosed', 'a,"closed"junk', 'a,un"quoted'])
    assert.throws(() => parseCsv(input), /quot/);
  assert.throws(() => parseCsv('x'.repeat(10001)), /10 KB/);
  assert.throws(() => parseCsv('header\n' + 'row\n'.repeat(101)), /100 rows/);
  assert.throws(
    () => imports.readRows({csv: 'productId,units,reason,evil\na,2,restock,x'}),
    /headers/,
  );
  assert.throws(() => imports.readRows(null), /import request/);
  assert.throws(
    () => imports.readRows({csv: 'productId,units,reason\na,2'}),
    /same number/,
  );
});

function products(t, variants = []) {
  t.mock.method(Product, 'find', () => ({
    select: () => ({
      lean: async () => [
        {_id: productId, name: 'Test shoe', stock: 3, variants},
      ],
    }),
  }));
}

test('restock preview resolves rows without changing stock and saves an actor-owned expiring confirmation', async (t) => {
  products(t);
  let saved;
  t.mock.method(InventoryBatch, 'create', async (value) => {
    saved = value;
    return {_id: batchId};
  });
  const at = new Date('2026-11-19T10:00:00Z');
  const result = await imports.preview({rows: [row]}, actor, at);
  assert.equal(result.valid, true);
  assert.equal(result.batchId, batchId);
  assert.equal(result.rows[0].units, 4);
  assert.equal(saved.actor, actor);
  assert.equal(saved.applyBefore.getTime() - at.getTime(), 15 * 60 * 1000);
  assert.equal(saved.rows[0].name, 'Test shoe');
});

test('preview reports duplicate targets, missing options, invalid quantities and reasons without creating a batch', async (t) => {
  products(t, [{_id: optionId, size: '9', stock: 3}]);
  t.mock.method(InventoryBatch, 'create', () =>
    assert.fail('invalid preview must not create an import'),
  );
  const result = await imports.preview(
    {rows: [row, row, {...row, optionId, units: '-1', reason: ''}]},
    actor,
  );
  assert.equal(result.valid, false);
  assert.equal(result.batchId, null);
  assert.ok(result.rows[0].errors.optionId);
  assert.ok(result.rows[1].errors.productId);
  assert.ok(result.rows[2].errors.units);
  assert.ok(result.rows[2].errors.reason);
});

test('confirmed batch applies saved values once; repeat requests return the saved result', async (t) => {
  let state = 'preview';
  const doc = {
    rows: [{...row, units: 4}],
    status: 'applying',
    results: [],
    save: async () => {
      state = doc.status;
    },
  };
  t.mock.method(InventoryBatch, 'findOneAndUpdate', async (filter) => {
    assert.equal(filter.actor, actor);
    assert.equal(filter.$or[0].status, 'preview');
    if (state !== 'preview') return null;
    state = 'applying';
    return doc;
  });
  t.mock.method(InventoryBatch, 'findOne', () => ({
    lean: async () => ({status: state, results: doc.results}),
  }));
  t.mock.method(InventoryBatch, 'updateOne', async (filter, update) => {
    assert.ok(filter.lockToken);
    doc.results = [...update.$set.results];
    if (update.$set.status) state = update.$set.status;
    return {matchedCount: 1};
  });
  const calls = [];
  const change = async (id, value) => calls.push({id, value});
  const result = await imports.apply(batchId, actor, change);
  assert.equal(result.status, 'completed');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].value.action, 'add');
  assert.equal(calls[0].value.units, 4);
  assert.deepEqual(await imports.apply(batchId, actor, change), result);
  assert.equal(calls.length, 1);
});

test('a running or expired batch cannot be replayed, and another actor cannot read its result', async (t) => {
  t.mock.method(InventoryBatch, 'findOneAndUpdate', async () => null);
  let previous = {status: 'applying'};
  t.mock.method(InventoryBatch, 'findOne', () => ({
    lean: async () => previous,
  }));
  const change = () => assert.fail('a claimed batch must not run again');
  await assert.rejects(
    imports.apply(batchId, actor, change),
    /batch is running/,
  );
  previous = {status: 'preview'};
  await assert.rejects(imports.apply(batchId, actor, change), /expired/);
  previous = null;
  await assert.rejects(imports.apply(batchId, actor, change), /not found/);
});

test('partial and uncertain failures are reported for review, never silently retried', async (t) => {
  const doc = {
    rows: [row, {...row, productId: optionId}],
    results: [],
    save: async () => {},
  };
  t.mock.method(InventoryBatch, 'findOneAndUpdate', async () => doc);
  t.mock.method(InventoryBatch, 'updateOne', async () => ({matchedCount: 1}));
  let calls = 0;
  const result = await imports.apply(batchId, actor, async () => {
    calls += 1;
    if (calls === 2) throw new HttpError(400, 'Not enough stock capacity.');
  });
  assert.equal(calls, 2);
  assert.deepEqual(
    result.results.map((item) => item.status),
    ['applied', 'review'],
  );
  assert.equal(result.results[1].message, 'Not enough stock capacity.');
});

test('concurrent confirmation requests cannot both execute the stock callback', async (t) => {
  t.mock.method(InventoryBatch, 'updateOne', async () => ({matchedCount: 1}));
  let claimed = false;
  let finish;
  let started;
  const gate = new Promise((resolve) => {
    finish = resolve;
  });
  const entered = new Promise((resolve) => {
    started = resolve;
  });
  const doc = {
    rows: [row],
    results: [],
    status: 'applying',
    save: async () => {},
  };
  t.mock.method(InventoryBatch, 'findOneAndUpdate', async () => {
    if (claimed) return null;
    claimed = true;
    return doc;
  });
  t.mock.method(InventoryBatch, 'findOne', () => ({
    lean: async () => ({status: 'applying'}),
  }));
  let calls = 0;
  const change = async () => {
    calls += 1;
    started();
    await gate;
  };
  const first = imports.apply(batchId, actor, change);
  await entered;
  try {
    await assert.rejects(
      imports.apply(batchId, actor, change),
      /batch is running/,
    );
  } finally {
    finish();
  }
  await first;
  assert.equal(calls, 1);
});

test('recovery after stock commits but progress saving fails reuses the same receipt and persists each row', async (t) => {
  const doc = {
    rows: [
      {...row, units: 4},
      {...row, productId: optionId, units: 5},
    ],
    results: [],
  };
  let failProgress = true;
  const checkpoints = [];
  t.mock.method(InventoryBatch, 'findOneAndUpdate', async (filter) => {
    assert.equal(filter.actor, actor);
    assert.ok(
      filter.$or.some(
        (branch) => branch.status === 'applying' && branch.lockedUntil,
      ),
    );
    return doc;
  });
  t.mock.method(InventoryBatch, 'updateOne', async (filter, update) => {
    assert.ok(filter.lockToken);
    if (failProgress) {
      failProgress = false;
      throw new Error('Progress write lost');
    }
    doc.results = [...update.$set.results];
    checkpoints.push(doc.results.length);
    return {matchedCount: 1};
  });
  const receipts = new Set();
  let unitsAdded = 0;
  const change = async (id, value) => {
    assert.match(value.requestId, new RegExp(`^batch:${batchId}:`));
    if (!receipts.has(value.requestId)) {
      receipts.add(value.requestId);
      unitsAdded += value.units;
    }
  };
  await assert.rejects(
    imports.apply(batchId, actor, change),
    /Progress write lost/,
  );
  assert.equal(unitsAdded, 4);
  const recovered = await imports.apply(batchId, actor, change);
  assert.equal(unitsAdded, 9, 'the first four units were not added again');
  assert.equal(recovered.results.length, 2);
  assert.deepEqual(checkpoints, [1, 2, 2]);
});
