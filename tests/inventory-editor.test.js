const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the actual drawer's submit and product-change handlers after a lost reply.
test('drawer retries retain their reference while switching products creates a separate reference', async () => {
  function node(extra = {}) {
    return {
      value: '',
      textContent: '',
      dataset: {},
      hidden: true,
      listeners: {},
      append() {},
      focus() {},
      setAttribute() {},
      addEventListener(type, callback) {
        this.listeners[type] = callback;
      },
      ...extra,
    };
  }
  const elements = Object.fromEntries(
    [
      'product',
      'size',
      'colour',
      'newSize',
      'newColour',
      'units',
      'reason',
      'note',
    ].map((name) => [name, node()]),
  );
  const nodes = new Map();
  const query = (selector) => {
    if (!nodes.has(selector)) nodes.set(selector, node());
    return nodes.get(selector);
  };
  const form = node({
    elements,
    querySelector: query,
    querySelectorAll: () => [],
    reset() {
      for (const field of Object.values(elements)) field.value = '';
    },
  });
  const dialog = node({
    open: false,
    querySelector: (selector) =>
      selector === '[data-stock-drawer-form]' ? form : query(selector),
    querySelectorAll: () => [],
    showModal() {
      this.open = true;
    },
    close() {
      this.open = false;
    },
  });
  const root = node({
    querySelector: (selector) => {
      if (selector === '[data-inventory-drawer]') return dialog;
      return {
        textContent: JSON.stringify([
          {id: 'product-a', stock: 3, options: []},
          {id: 'product-b', stock: 3, options: []},
        ]),
      };
    },
  });
  const storage = new Map();
  const requests = [];
  const context = {
    window: {
      crypto: require('node:crypto').webcrypto,
      sessionStorage: {
        getItem: (key) => storage.get(key) || null,
        setItem: (key, value) => storage.set(key, value),
      },
    },
    document: {
      createElement: () => node(),
      documentElement: {classList: {add() {}, remove() {}}},
    },
    Nx: {
      clearErrors() {},
      submitForm: async (actualForm, request) => {
        requests.push(request);
        return null;
      },
    },
  };
  vm.runInNewContext(
    fs.readFileSync(
      path.join(__dirname, '../public/js/inventory-editor.js'),
      'utf8',
    ),
    context,
  );
  context.window.NxInventoryEditor.mount(root, new AbortController().signal);
  const button = node({
    dataset: {inventoryEdit: 'product-a'},
    hasAttribute: () => false,
  });
  root.listeners.click({
    target: {
      closest: (selector) =>
        selector === '[data-inventory-edit]' ? button : null,
    },
  });
  async function submit() {
    elements.units.value = '2';
    form.listeners.input();
    await form.listeners.submit({preventDefault() {}});
  }
  await submit();
  await submit();
  assert.equal(requests[0].body.requestId, requests[1].body.requestId);
  elements.product.value = 'product-b';
  form.listeners.change({target: elements.product});
  await submit();
  assert.notEqual(requests[2].body.requestId, requests[0].body.requestId);
  assert.match(requests[2].url, /product-b$/);
  elements.product.value = 'product-a';
  form.listeners.change({target: elements.product});
  await submit();
  assert.equal(requests[3].body.requestId, requests[0].body.requestId);
});
