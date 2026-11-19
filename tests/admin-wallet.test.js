require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const User = require('../models/User');
const Wallet = require('../models/Wallet');
const Transaction = require('../models/WalletTransaction');
const audit = require('../services/auditService');
const service = require('../services/adminWalletService');
const userId = 'a'.repeat(24);
const actor = {actor: 'b'.repeat(24), actorRole: 'admin'};
const input = (extra) => ({
  type: 'credit',
  amount: '125.50',
  reason: 'Goodwill credit',
  requestId: crypto.randomUUID(),
  ...extra,
});

function database(t, initial = 0) {
  const state = {
    balance: initial,
    entries: new Map(),
    receipts: new Set(),
    logs: [],
    failHistory: false,
  };
  t.mock.method(User, 'findOne', (filter) => ({
    select: () => ({
      lean: async () =>
        filter.role === 'customer' && filter.isDeleted.$ne === true
          ? {_id: userId, name: 'Nishan', email: 'test@example.com'}
          : null,
    }),
  }));
  t.mock.method(Transaction, 'create', async ([value]) => {
    if (state.entries.has(value.key))
      throw Object.assign(new Error('duplicate'), {code: 11000});
    const entry = {
      ...value,
      _id: crypto.randomUUID(),
      toObject() {
        return {...this};
      },
    };
    state.entries.set(value.key, entry);
    return [entry];
  });
  t.mock.method(Transaction, 'findOne', async ({key}) =>
    state.entries.get(key),
  );
  t.mock.method(Transaction, 'updateOne', async (filter, update) => {
    if (state.failHistory) {
      state.failHistory = false;
      throw new Error('history unavailable');
    }
    const entry = [...state.entries.values()].find(
      (item) => item._id === filter._id,
    );
    Object.assign(entry, update.$set);
  });
  t.mock.method(Wallet, 'updateOne', async () => ({}));
  t.mock.method(Wallet, 'findOneAndUpdate', async (filter, update) => {
    assert.equal(filter.user, userId);
    const receipt = update.$addToSet.adjustmentReceipts;
    assert.equal(filter.adjustmentReceipts.$ne, receipt);
    if (
      state.receipts.has(receipt) ||
      (filter.balance && state.balance < filter.balance.$gte)
    )
      return null;
    state.receipts.add(receipt);
    state.balance += update.$inc.balance;
    return {balance: state.balance};
  });
  t.mock.method(Wallet, 'findOne', async (filter) =>
    state.receipts.has(filter.adjustmentReceipts)
      ? {balance: state.balance}
      : null,
  );
  t.mock.method(audit, 'record', async (value) => state.logs.push(value));
  return state;
}

test('admin wallet amounts, action, reason and request identity are validated', () => {
  assert.equal(service.validateAdjustment(input()).amount, 12550);
  for (const amount of ['0', '-1', '1.001', '100000.01', 'Infinity', {}, '1e3'])
    assert.throws(
      () => service.validateAdjustment(input({amount})),
      (error) => error.status === 400,
    );
  for (const value of [
    null,
    input({type: 'set'}),
    input({reason: ' '}),
    input({reason: 'x'.repeat(161)}),
    input({requestId: '-'.repeat(36)}),
  ])
    assert.throws(
      () => service.validateAdjustment(value),
      (error) => error.status === 400,
    );
});

test('only admins can adjust credit, and only customer accounts can be targeted', async (t) => {
  await assert.rejects(
    service.adjust(userId, input(), {actor: userId, actorRole: 'customer'}),
    (error) => error.status === 403,
  );
  await assert.rejects(
    service.adjust('invalid', input(), actor),
    (error) => error.status === 404,
  );
  t.mock.method(User, 'findOne', () => ({
    select: () => ({lean: async () => null}),
  }));
  await assert.rejects(
    service.adjust(userId, input(), actor),
    (error) => error.status === 404,
  );
});

test('admin credit appears in history and audit, and parallel retries apply it once', async (t) => {
  const state = database(t);
  const body = input();
  const results = await Promise.all([
    service.adjust(userId, body, actor),
    service.adjust(userId, body, actor),
  ]);
  assert.equal(state.balance, 12550);
  assert.equal(state.entries.size, 1);
  assert.equal(results[0].transaction.kind, 'admin');
  assert.equal(results[0].transaction.balanceAfter, 12550);
  assert.equal(results[1].repeated, true);
  assert.equal(state.logs.length, 1);
  assert.equal(state.logs[0].actor, actor.actor);
});

test('a debit cannot exceed balance; successful debit and retries preserve balance', async (t) => {
  const state = database(t, 20000);
  await assert.rejects(
    service.adjust(userId, input({type: 'debit', amount: '201'}), actor),
    (error) => error.status === 409,
  );
  assert.equal(state.balance, 20000);
  const body = input({type: 'debit', amount: '50'});
  await service.adjust(userId, body, actor);
  await service.adjust(userId, body, actor);
  assert.equal(state.balance, 15000);
  assert.equal(state.logs.length, 1);
});

for (const type of ['credit', 'debit'])
  test(`a ${type} interrupted after changing balance is safely repaired on retry`, async (t) => {
    const state = database(t, 20000);
    state.failHistory = true;
    const body = input({type, amount: '50'});
    await assert.rejects(
      service.adjust(userId, body, actor),
      /history unavailable/,
    );
    const expected = type === 'credit' ? 25000 : 15000;
    assert.equal(state.balance, expected);
    await service.adjust(userId, body, actor);
    assert.equal(state.balance, expected);
    assert.equal([...state.entries.values()][0].applied, true);
  });

test('reusing an adjustment key with another amount or customer is rejected', async (t) => {
  const state = database(t);
  const body = input();
  await service.adjust(userId, body, actor);
  await assert.rejects(
    service.adjust(userId, {...body, amount: '100'}, actor),
    (error) => error.status === 409,
  );
  await assert.rejects(
    service.adjust('c'.repeat(24), body, actor),
    (error) => error.status === 409,
  );
  assert.equal(state.balance, 12550);
});

test('wallet page renders empty and populated histories and escapes customer text', async () => {
  const ejs = require('ejs');
  const path = require('node:path');
  const {formatPaise} = require('../utils/money');
  for (const populated of [false, true]) {
    const html = await ejs.renderFile(
      path.join(__dirname, '../views/admin/customer-wallet.ejs'),
      {
        partial: true,
        title: 'Customer wallet',
        adminPath: '/admin',
        icon: () => '',
        formatPrice: formatPaise,
        formatDate: () => '17 Nov 2026',
        customer: {
          id: userId,
          name: '<script>bad()</script>',
          email: 'test@example.com',
        },
        balance: 10000,
        totals: {credited: 10000, debited: 0},
        transactions: populated
          ? [
              {
                type: 'credit',
                amount: 10000,
                balanceAfter: 10000,
                reason: 'Goodwill',
                kind: 'admin',
                createdAt: new Date(),
              },
            ]
          : [],
        pagination: {page: 1, pages: populated ? 2 : 1},
        link: () => '?page=2',
      },
    );
    assert.ok(html.includes('data-page="admin-customer-wallet"'));
    assert.ok(html.includes('data-admin-wallet-form'));
    assert.ok(!html.includes('<script>bad()'));
    assert.equal(html.includes('Goodwill</td>'), populated);
    assert.equal(html.includes('No wallet transactions yet.'), !populated);
  }
});

test('admin wallet form retries an uncertain response with the same request id', async () => {
  const vm = require('node:vm');
  const fs = require('node:fs');
  const calls = [];
  let submit;
  let setup;
  let reloads = 0;
  let alert = '';
  const button = {};
  const form = {
    dataset: {userId},
    elements: {
      type: {value: 'credit'},
      amount: {value: '10'},
      reason: {value: 'Goodwill'},
    },
    reportValidity: () => true,
    querySelector: () => button,
    addEventListener: (event, handler) => {
      if (event === 'submit') submit = handler;
    },
  };
  const root = {
    querySelector: (selector) =>
      selector === 'h1' ? {textContent: 'Nishan'} : form,
  };
  const context = {
    crypto,
    window: {
      NxPages: {
        define: (_name, handler) => {
          setup = handler;
        },
      },
      location: {
        reload: () => {
          reloads++;
        },
      },
    },
    Nx: {
      clearErrors() {},
      showErrors() {},
      busy() {},
      flash() {},
      formAlert: (_form, message) => {
        alert = message;
      },
      confirm: async () => true,
      api: async (_url, options) => {
        calls.push(options.body);
        if (calls.length === 1) throw new Error('Network interrupted');
        return {message: 'Wallet updated'};
      },
    },
  };
  vm.runInNewContext(
    fs.readFileSync(
      require('node:path').join(__dirname, '../public/js/admin-wallet.js'),
      'utf8',
    ),
    context,
  );
  setup(root, {aborted: false});
  await submit({preventDefault() {}});
  assert.equal(alert, 'Network interrupted');
  await submit({preventDefault() {}});
  assert.equal(calls[0].requestId, calls[1].requestId);
  assert.equal(reloads, 1);
});
