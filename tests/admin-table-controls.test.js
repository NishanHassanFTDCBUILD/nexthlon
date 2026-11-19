const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const ejs = require('ejs');
const fs = require('node:fs');
const {linkBuilder} = require('../utils/queryString');

test('admin tables do not load the removed Columns or Row height controls', () => {
  const shell = fs.readFileSync(
    path.join(__dirname, '../views/partials/admin-end.ejs'),
    'utf8',
  );
  const orders = fs.readFileSync(
    path.join(__dirname, '../views/admin/orders.ejs'),
    'utf8',
  );
  const script = fs.readFileSync(
    path.join(__dirname, '../public/js/admin-orders.js'),
    'utf8',
  );
  assert.doesNotMatch(shell, /['"]admin-lists['"]/);
  assert.doesNotMatch(orders, /data-col-toggle|orders-columns/);
  assert.doesNotMatch(script, /applyColumns|nx-admin-cols-orders/);
  assert.equal(
    fs.existsSync(path.join(__dirname, '../public/js/admin-lists.js')),
    false,
  );
});

test('sortable header announces current direction, reverses it, resets page and retains filters', async () => {
  for (const [sort, direction, next] of [
    ['price_asc', 'ascending', 'price_desc'],
    ['price_desc', 'descending', 'price_asc'],
    ['newest', 'none', 'price_asc'],
  ]) {
    const html = await ejs.renderFile(
      path.join(__dirname, '../views/partials/admin-sort-header.ejs'),
      {
        label: 'Price',
        asc: 'price_asc',
        desc: 'price_desc',
        filters: {sort},
        link: linkBuilder('/private/products', {
          sort,
          page: 4,
          category: 'test',
          limit: 50,
        }),
      },
    );
    assert.ok(html.includes(`aria-sort="${direction}"`));
    const href = /href="([^"]+)"/.exec(html)[1].replaceAll('&amp;', '&');
    const url = new URL(href, 'http://test');
    assert.equal(url.searchParams.get('sort'), next);
    assert.equal(url.searchParams.get('category'), 'test');
    assert.equal(url.searchParams.get('limit'), '50');
    assert.equal(url.searchParams.has('page'), false);
  }
});
