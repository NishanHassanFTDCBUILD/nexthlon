const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function mount() {
  const node = (extra = {}) => ({
    textContent: '',
    hidden: false,
    value: '',
    events: {},
    addEventListener(name, fn) {
      this.events[name] = fn;
    },
    focus() {},
    ...extra,
  });
  const bits = Object.fromEntries(
    ['action-label', 'change', 'after', 'preview-hint'].map((key) => [
      '[data-wallet-' + key + ']',
      node(),
    ]),
  );
  const preview = {
    querySelector: (key) => bits[key],
    classList: {
      toggle(name, value) {
        this[name] = value;
      },
    },
  };
  const form = node({
    dataset: {balance: '10000', userId: 'test'},
    elements: {
      amount: {value: ''},
      type: {value: 'credit'},
      reason: {value: ''},
    },
    querySelector: (key) => (key === '[data-wallet-preview]' ? preview : null),
  });
  const search = node();
  const type = node({value: 'all'});
  const tools = {
    hidden: true,
    hasAttribute: () => true,
    querySelector: (key) => (key.includes('search') ? search : type),
  };
  const rows = [
    node({dataset: {type: 'credit'}, textContent: 'Goodwill Admin adjustment'}),
    node({dataset: {type: 'debit'}, textContent: 'Order payment NX-123'}),
  ];
  const status = node();
  const empty = node();
  const reset = node();
  const nodes = {
    '[data-admin-wallet-form]': form,
    '[data-wallet-history-tools]': tools,
    '[data-wallet-history-status]': status,
    '[data-wallet-history-empty]': empty,
    '[data-wallet-history-reset]': reset,
  };
  const root = {
    querySelector: (key) => nodes[key],
    querySelectorAll: () => rows,
  };
  vm.runInNewContext(
    fs.readFileSync(
      path.join(__dirname, '../public/js/admin-wallet.js'),
      'utf8',
    ),
    {
      window: {
        NxPages: {
          define(name, setup) {
            setup(root, {});
          },
        },
      },
      sessionStorage: {getItem: () => null},
      Intl,
    },
  );
  return {form, bits, preview, search, type, rows, empty, reset, status};
}

test('wallet preview calculates credit/debit in paise and flags overdrafts', () => {
  const ui = mount();
  ui.form.elements.amount.value = '25.50';
  ui.form.events.input();
  assert.equal(ui.bits['[data-wallet-after]'].textContent, '₹125.50');
  ui.form.elements.type.value = 'debit';
  ui.form.events.change();
  assert.equal(ui.bits['[data-wallet-after]'].textContent, '₹74.50');
  ui.form.elements.amount.value = '101';
  ui.form.events.input();
  assert.equal(ui.preview.classList['is-invalid'], true);
  assert.match(ui.bits['[data-wallet-preview-hint]'].textContent, /exceeds/);
  ui.form.elements.amount.value = '1.001';
  ui.form.events.input();
  assert.equal(ui.bits['[data-wallet-change]'].textContent, '—');
});

test('history combines type and search, exposes empty state and resets both filters', () => {
  const ui = mount();
  ui.search.value = 'NX-123';
  ui.search.events.input();
  assert.deepEqual(
    ui.rows.map((row) => row.hidden),
    [true, false],
  );
  ui.type.value = 'credit';
  ui.type.events.change();
  assert.equal(ui.empty.hidden, false);
  ui.reset.events.click();
  assert.equal(ui.search.value, '');
  assert.equal(ui.type.value, 'all');
  assert.ok(ui.rows.every((row) => !row.hidden));
  assert.equal(ui.empty.hidden, true);
});
