const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function editor(api) {
  const modules = {};
  const listeners = [];
  const fields = ['a', 'b'].map((id) => ({
    value: id === 'a' ? '5' : '8',
    dataset: {optionId: id, stock: '2'},
    disabled: false,
    classList: {add() {}, remove() {}},
    focus() {},
  }));
  const action = {value: 'count', disabled: false};
  const status = {textContent: ''};
  const form = {
    dataset: {invForm: 'product'},
    elements: {
      action,
      reason: {value: 'restock', disabled: false, focus() {}},
      note: {value: '', disabled: false},
    },
    querySelector: (selector) =>
      selector.includes('save-status') ? status : {},
    querySelectorAll: (selector) =>
      selector.includes('data-inv-field') ? fields : [...fields, action],
    closest: (selector) =>
      selector === '[data-inv-row]'
        ? row
        : selector === '[data-inv-form]'
          ? form
          : null,
  };
  const row = {
    querySelectorAll: () => fields,
    querySelector: (selector) =>
      selector === '[data-inv-action]'
        ? action
        : selector === '[data-stock-history]'
          ? null
          : {textContent: '', className: ''},
  };
  const root = {
    querySelector: () => null,
    addEventListener: (type, callback) => {
      if (type === 'submit') listeners.push(callback);
    },
  };
  vm.runInNewContext(
    fs.readFileSync(
      path.join(__dirname, '../public/js/admin-catalog.js'),
      'utf8',
    ),
    {
      window: {
        crypto: require('node:crypto').webcrypto,
        NxPages: {
          define: (name, setup) => {
            modules[name] = setup;
          },
        },
      },
      document: {addEventListener() {}},
      Nx: {api, busy() {}, toast() {}},
      Intl,
    },
  );
  modules['admin-inventory'](root, {aborted: false});
  return {
    fields,
    status,
    submit: () =>
      Promise.all(
        listeners.map((callback) =>
          callback({target: form, preventDefault() {}}),
        ),
      ),
  };
}

test('partial size-save failure preserves failed quantities and refreshes successful counts', async () => {
  let calls = 0;
  const page = editor(async () => {
    calls++;
    if (calls === 2) throw new Error('Connection lost.');
    return {
      message: 'Saved',
      product: {
        name: 'Shoes',
        stock: 7,
        stockValue: 70000,
        state: 'healthy',
        options: [
          {id: 'a', stock: 5},
          {id: 'b', stock: 2},
        ],
      },
    };
  });
  await page.submit();
  assert.equal(page.fields[0].value, '5');
  assert.equal(page.fields[0].dataset.stock, '5');
  assert.equal(page.fields[1].value, '8');
  assert.equal(page.fields[1].dataset.stock, '2');
  assert.ok(page.fields.every((field) => !field.disabled));
  assert.match(page.status.textContent, /1 change saved/);
  assert.match(page.status.textContent, /Entered quantities are kept/);
});

test('duplicate stock form submissions cannot send an adjustment twice', async () => {
  let calls = 0;
  let finish;
  const page = editor(() => {
    calls++;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const pending = page.submit();
  await page.submit();
  assert.equal(calls, 1);
  // Complete each variant request separately while the form remains locked.
  finish({
    message: 'Saved',
    product: {
      name: 'Shoes',
      stock: 7,
      stockValue: 70000,
      state: 'healthy',
      options: [
        {id: 'a', stock: 5},
        {id: 'b', stock: 2},
      ],
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  finish({
    message: 'Saved',
    product: {
      name: 'Shoes',
      stock: 13,
      stockValue: 130000,
      state: 'healthy',
      options: [
        {id: 'a', stock: 5},
        {id: 'b', stock: 8},
      ],
    },
  });
  await pending;
  assert.equal(calls, 2);
});

test('retrying an uncertain stock save keeps its original request ID and count snapshot', async () => {
  const bodies = [];
  const page = editor(async (url, options) => {
    bodies.push(options.body);
    if (bodies.length === 1) throw new Error('Reply lost');
    return {
      message: 'Saved',
      product: {
        name: 'Shoes',
        stock: 13,
        stockValue: 130000,
        state: 'healthy',
        options: [
          {id: 'a', stock: 5},
          {id: 'b', stock: 8},
        ],
      },
    };
  });
  await page.submit();
  await page.submit();
  assert.equal(bodies[0].requestId, bodies[1].requestId);
  assert.equal(bodies[0].expectedStock, 2);
  assert.equal(bodies[1].expectedStock, 2);
  assert.notEqual(bodies[1].requestId, bodies[2].requestId);
});
