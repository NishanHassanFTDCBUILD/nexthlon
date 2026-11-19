const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const ejs = require('ejs');
const {linkBuilder} = require('../utils/queryString');

async function render(overrides = {}) {
  const filters = {
    q: '',
    category: '',
    status: 'all',
    sort: 'newest',
    limit: '',
    ...overrides,
  };
  return ejs.renderFile(path.join(__dirname, '../views/admin/products.ejs'), {
    partial: true,
    title: 'Test products',
    adminPath: '/test-console',
    filters,
    products: [],
    categories: [{_id: 'category1', name: 'Running & sport'}],
    sorts: {newest: {label: 'Newest'}},
    pagination: {total: 0, pages: 1, page: 1, limit: 50},
    icon: () => '',
    link: linkBuilder('/test-console/products', {...filters, page: 3}),
  });
}

test('product filters: removals retain other filters, sorting and page size but reset page', async () => {
  const html = await render({
    q: '<shoe>',
    category: 'category1',
    status: 'low',
    limit: 50,
  });
  assert.match(html, /Search: &lt;shoe&gt;/);
  assert.match(html, /Category: Running &amp; sport/);
  assert.match(html, /Status: Low stock/);
  assert.match(html, /admin-more-count">2</);
  const chips = [...html.matchAll(/class="admin-chip" href="([^"]+)"/g)].map(
    (m) => new URL(m[1].replaceAll('&amp;', '&'), 'http://test'),
  );
  assert.equal(chips.length, 3);
  for (const [index, key] of ['q', 'category', 'status'].entries()) {
    assert.equal(chips[index].searchParams.has(key), false);
    assert.equal(chips[index].searchParams.has('page'), false);
    assert.equal(chips[index].searchParams.get('limit'), '50');
    assert.equal(chips[index].searchParams.get('sort'), 'newest');
  }
  assert.match(html, /name="limit" value="50"/);
  assert.match(html, /Clear these/);
  assert.match(html, /Apply filters/);
});

test('product filters: unfiltered page has no chips and panel starts closed', async () => {
  const html = await render();
  assert.doesNotMatch(html, /class="admin-chip"/);
  assert.match(html, /<details class="admin-more-filters"\s*>/);
});
