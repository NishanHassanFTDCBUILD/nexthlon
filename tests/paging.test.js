// The admin table paging helper (utils/paging.js): page number, rows per page and in-memory pages.
const test = require('node:test');
const assert = require('node:assert/strict');
const {pageNumber, pagination, pageOf} = require('../utils/paging');

test('paging: junk page numbers fall back to page 1', () => {
  for (const page of [undefined, '', '0', '-3', 'abc', '1e9'])
    assert.equal(pageNumber({page}), 1);
  assert.equal(pageNumber({page: '4'}), 4);
});

test('paging: rows per page is 20, 50 or 100, and a page past the end shows the last one', () => {
  assert.deepEqual(pagination(45, {page: '9'}), {
    page: 3,
    pages: 3,
    total: 45,
    limit: 20,
  });
  assert.equal(pagination(45, {limit: '50'}).pages, 1);
  assert.equal(pagination(45, {limit: '999'}).limit, 20);
  assert.deepEqual(pagination(0, {}), {page: 1, pages: 1, total: 0, limit: 20});
});

test('paging: pageOf slices an in-memory list', () => {
  const rows = Array.from({length: 45}, (_, i) => i + 1);
  const second = pageOf(rows, {page: '2'});
  assert.deepEqual(second.rows, rows.slice(20, 40));
  assert.equal(second.pagination.page, 2);
  const last = pageOf(rows, {page: '3'});
  assert.deepEqual(last.rows, [41, 42, 43, 44, 45]);
});
