require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const cart = require('../services/cartService');
const Product = require('../models/Product');
const stock = require('../services/stockService');
const id = '0123456789abcdef01234567';
const redId = '1123456789abcdef01234567';
const blueId = '2123456789abcdef01234567';
const shoe = {
  _id: id,
  name: 'Shoe',
  slug: 'shoe',
  isListed: true,
  stock: 5,
  price: 10000,
  mrp: 10000,
  image: '/shoe.jpg',
  variants: [
    {_id: redId, size: '9', colour: 'Red', stock: 2},
    {_id: blueId, size: '10', colour: 'Blue', stock: 3},
  ],
  colourPhotos: [
    {colour: 'Red', image: '/red.jpg'},
    {colour: 'Blue', image: '/blue.jpg'},
  ],
};

test('cart quantities and photos follow the exact colour and size combination', () => {
  const view = cart.buildCartView([
    {product: shoe, variant: redId, quantity: 1},
    {product: shoe, variant: blueId, quantity: 2},
  ]);
  assert.deepEqual(
    view.items.map((item) => item.stock),
    [2, 3],
  );
  assert.deepEqual(
    view.items.map((item) => item.image),
    ['/red.jpg', '/blue.jpg'],
  );
  assert.match(cart.quantityProblem(shoe, 3, redId), /Only 2/);
  assert.equal(cart.quantityProblem(shoe, 3, blueId), null);
  assert.match(cart.quantityProblem(shoe, 1), /Choose/);
});

test('removed variants cannot spend or display a newly general stock pool', () => {
  const changed = {...shoe, variants: [], stock: 20};
  assert.match(cart.quantityProblem(changed, 1, redId), /no longer available/);
  const view = cart.buildCartView([
    {product: changed, variant: redId, quantity: 1},
  ]);
  assert.equal(view.items[0].available, false);
  assert.equal(view.summary.subtotal, 0);
  assert.equal(cart.stockFor(changed, redId), 0);
});

test('general stock take and return filters exclude products that acquired variants', async (t) => {
  const filters = [];
  t.mock.method(Product, 'updateOne', async (filter) => {
    filters.push(filter);
    return {modifiedCount: 1};
  });
  const lines = [{product: id, quantity: 1, name: 'Shoe'}];
  await stock.takeStock(lines);
  await stock.returnStock(lines);
  await stock.takeStockOnce(lines, 'test-reservation');
  await stock.returnStockOnce(lines, 'test-return');
  assert.equal(filters.length, 4);
  for (const filter of filters)
    assert.deepEqual(filter['variants.0'], {$exists: false});
});

test('a thrown stock write rolls back earlier successful lines on standalone MongoDB', async (t) => {
  const movements = [];
  t.mock.method(Product, 'updateOne', async (filter, update) => {
    movements.push(update.$inc.stock);
    if (movements.length === 2) throw new Error('Write rejected');
    return {modifiedCount: 1};
  });
  await assert.rejects(
    stock.takeStock([
      {product: id, quantity: 2},
      {product: blueId, quantity: 1},
    ]),
    /Write rejected/,
  );
  assert.deepEqual(movements, [-2, -1, 2]);
});

test('switching shoe colour clears an incompatible size and selects the correct variant', () => {
  const inputs = ['size:9', 'size:10', 'colour:Red', 'colour:Blue'].map(
    (value) => {
      const [name, choice] = value.split(':');
      return {
        name,
        value: choice,
        checked: choice === '9' || choice === 'Red',
        disabled: false,
        closest: () => ({classList: {toggle() {}}}),
      };
    },
  );
  const hidden = {value: ''};
  const message = {textContent: ''};
  let change;
  const box = {
    classList: {toggle() {}, remove() {}},
    addEventListener: (name, fn) => {
      if (name === 'change') change = fn;
    },
    querySelector: (selector) => {
      if (selector === '[data-options-json]')
        return {
          textContent: JSON.stringify(
            shoe.variants.map((option) => ({...option, id: option._id})),
          ),
        };
      if (selector === '[data-variant-input]') return hidden;
      if (selector === '[data-opt-msg]') return message;
      if (selector.includes('data-opt-group')) return {};
      const name = /input\[name="(.*?)"\]/.exec(selector)?.[1];
      return name
        ? inputs.find((input) => input.name === name && input.checked) || null
        : null;
    },
    querySelectorAll: (selector) => {
      const name = /input\[name="(.*?)"\]/.exec(selector)?.[1];
      return name ? inputs.filter((input) => input.name === name) : [];
    },
  };
  const source = fs.readFileSync(
    require('path').join(__dirname, '../public/js/cart.js'),
    'utf8',
  );
  const functionSource = source.slice(
    source.indexOf('  function setupOptions('),
    source.indexOf('  const addForm ='),
  );
  const setup = new Function(
    'document',
    'window',
    'CustomEvent',
    functionSource + '\nreturn setupOptions;',
  )(
    {querySelector: () => null, dispatchEvent() {}},
    {location: {search: ''}},
    class {},
  );
  setup({
    querySelector: (selector) => (selector === '[data-options]' ? box : null),
  });
  assert.equal(hidden.value, redId);
  assert.equal(
    inputs[3].disabled,
    false,
    'another in-stock colour remains selectable',
  );
  inputs[2].checked = false;
  inputs[3].checked = true;
  change({target: inputs[3]});
  assert.equal(inputs[0].checked, false);
  assert.equal(hidden.value, '');
  assert.equal(inputs[1].disabled, false);
  inputs[1].checked = true;
  change({target: inputs[1]});
  assert.equal(hidden.value, blueId);
});
