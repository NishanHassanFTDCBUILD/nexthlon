const test = require('node:test');
const assert = require('node:assert/strict');
const {readListQuery, runList} = require('../utils/listQuery');

const schema = {
  path: '/admin/items',
  pageSize: 20,
  defaultSort: 'name',
  searchFields: ['name'],
  sorts: {
    name: {label: 'Name', order: {name: 1}},
    newest: {label: 'Newest', order: {createdAt: -1}},
  },
  fields: {
    status: {
      values: ['active', 'hidden'],
      default: 'all',
      label: 'Status',
      match: (v) => ({isListed: v === 'active'}),
    },
  },
};

test('list query supports safe numeric paging from internal callers while rejecting mixed strings', () => {
  const list = readListQuery({page: 2, limit: 50}, schema);
  assert.equal(list.skip, 50);
  assert.equal(list.size, 50);
  assert.equal(readListQuery({page: '2x', limit: '50x'}, schema).size, 20);
  assert.equal(readListQuery({page: Infinity}, schema).filters.page, 1);
});

test('list query rejects query objects, unknown sorts, oversized limits and malformed pages', () => {
  const list = readListQuery(
    {
      q: {$ne: ''},
      status: ['active'],
      sort: '__proto__',
      page: '2junk',
      limit: '100000',
    },
    schema,
  );
  assert.deepEqual(list.mongo, {});
  assert.equal(list.filters.status, 'all');
  assert.equal(list.filters.page, 1);
  assert.equal(list.size, 20);
  assert.deepEqual(list.order, {name: 1, _id: 1});
});

test('list matrix: filters, sorts and page sizes compose without changing the base security filter', () => {
  for (const status of ['all', 'active', 'hidden']) {
    for (const sort of ['name', 'newest']) {
      for (const limit of ['20', '50', '100']) {
        const list = readListQuery(
          {status, sort, limit, page: '2', q: 'a.*'},
          {...schema, baseFilter: {tenant: 'test'}},
        );
        assert.equal(list.skip, Number(limit));
        assert.equal(
          list.pagination(201).pages,
          Math.ceil(201 / Number(limit)),
        );
        assert.deepEqual(list.mongo.$and[0], {tenant: 'test'});
        assert.equal(list.mongo.$and[1].$or[0].name.source, 'a\\.\\*');
        assert.equal(list.chips.length, status === 'all' ? 1 : 2);
      }
    }
  }
});

test('list runner applies database paging before mapping and counts the identical filter', async () => {
  const calls = {};
  const chain = Object.fromEntries(
    ['sort', 'skip', 'limit', 'select', 'populate'].map((key) => [
      key,
      (v) => {
        calls[key] = v;
        return chain;
      },
    ]),
  );
  chain.lean = async () => [{name: 'test'}];
  const Model = {
    find: (v) => {
      calls.find = v;
      return chain;
    },
    countDocuments: async (v) => {
      calls.count = v;
      return 51;
    },
  };
  const result = await runList(
    Model,
    {status: 'active', page: '2', limit: '50'},
    schema,
    {map: (v) => v.name},
  );
  assert.deepEqual(calls.find, calls.count);
  assert.equal(calls.skip, 50);
  assert.equal(calls.limit, 50);
  assert.deepEqual(result.rows, ['test']);
  assert.equal(result.pagination.pages, 2);
});
