const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const ejs = require('ejs');
const {validateStockChange} = require('../utils/validators');
const {linkBuilder} = require('../utils/queryString');
const inventory = require('../services/inventoryService');

test('stock changes preserve a valid reason, reject unknown reasons, and retain legacy API compatibility', () => {
  for (const action of ['add', 'remove', 'count']) {
    const good = validateStockChange({
      action,
      units: 2,
      reason: 'damage',
      note: 'Test count',
    });
    assert.deepEqual(good.errors, {});
    assert.equal(good.value.reason, 'damage');
    assert.equal(good.value.note, 'Test count');
    assert.ok(
      validateStockChange({action, units: 2, reason: 'unknown'}).errors.reason,
    );
  }
  assert.equal(
    validateStockChange({action: 'count', units: 0}).value.reason,
    'stock_count',
  );
});

test('inventory renders every existing sort and status, stock value, alert counts and labelled corrections', async () => {
  const filters = {
    q: '',
    category: '',
    status: 'all',
    sort: 'stock_asc',
    limit: 50,
  };
  const html = await ejs.renderFile(
    path.join(__dirname, '../views/admin/inventory.ejs'),
    {
      partial: true,
      title: 'Test stock',
      adminPath: '/private',
      filters,
      categories: [],
      sorts: inventory.SORTS,
      statusLabels: inventory.STATUS_LABELS,
      totals: {units: 3, lowStockLimit: 5, low: 1, out: 0},
      exportQuery: '',
      pagination: {total: 1, pages: 1, page: 1, limit: 50},
      products: [
        {
          id: 'test',
          name: '<test>',
          category: 'Running',
          stock: 3,
          stockValue: 60000,
          waiting: 2,
          state: 'low',
          isListed: true,
          options: [],
        },
      ],
      icon: () => '',
      formatDate: () => 'Test date',
      formatPrice: (value) => `paise:${value}`,
      link: linkBuilder('/private/inventory', filters),
    },
  );
  for (const key of Object.keys(inventory.SORTS))
    assert.ok(html.includes(`value="${key}"`));
  for (const key of ['out', 'low', 'healthy', 'unlisted'])
    assert.ok(html.includes(`value="${key}"`));
  assert.match(html, /paise:60000/);
  assert.match(html, /data-label="Waiting for alerts">2/);
  assert.match(html, /name="reason" required/);
  assert.match(html, /data-stock-history="test"/);
  assert.match(html, /&lt;test&gt;/);
  assert.match(html, /<table /);
});
