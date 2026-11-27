const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const ejs = require('ejs');
const {linkBuilder} = require('../utils/queryString');

for (const section of [
  'categories',
  'coupons',
  'deals',
  'users',
  'returns',
  'transactions',
]) {
  test(`list page ${section}: shared panel renders with active chips and preserved page size`, async () => {
    const filters = {
      q: '<test>',
      status: 'all',
      type: 'all',
      method: 'all',
      from: '',
      to: '',
      sort: 'newest',
      limit: 50,
    };
    const html = await ejs.renderFile(
      path.join(__dirname, `../views/admin/${section}.ejs`),
      {
        partial: true,
        title: 'Test',
        adminPath: '/private',
        adminCan: (permission) =>
          require('../utils/permissions').can('owner', permission),
        filters,
        sorts: {newest: {label: 'Newest'}},
        totals: {
          all: 0,
          listed: 0,
          hidden: 0,
          active: 0,
          uses: 0,
          discountGiven: 0,
          disabled: 0,
          expired: 0,
          used_up: 0,
          live: 0,
          scheduled: 0,
          ended: 0,
          in: 0,
          out: 0,
          net: 0,
          other: 0,
        },
        counts: {requested: 0, approved: 0, rejected: 0},
        byStatus: {},
        categories: [],
        coupons: [],
        deals: [],
        countdown: {dealsCountdownMode: 'auto', dealsCountdownEndsAt: ''},
        countdownEndsInput: '',
        countdownAutoEndsAt: '2026-11-21T18:30:00.000Z',
        customers: [],
        returns: [],
        transactions: [],
        refunds: [],
        pagination: {page: 1, pages: 1, total: 0, limit: 50},
        types: ['payment'],
        typeLabels: {payment: 'Online payment'},
        txStatuses: ['pending'],
        txMethods: ['wallet'],
        icon: () => '',
        formatPrice: () => '0',
        exportQuery: '',
        link: linkBuilder(`/private/${section}`, filters),
      },
    );
    assert.match(html, /More filters/);
    assert.match(html, /Apply filters/);
    assert.match(html, /Clear these/);
    assert.match(html, /Search: &lt;test&gt;/);
    assert.match(html, /name="limit" value="50"/);
  });
}

test('shared filters: clearing a return status selects all instead of the default waiting tab', async () => {
  const filters = {q: 'test', status: 'approved', page: 4, limit: 100};
  const html = await ejs.renderFile(
    path.join(__dirname, '../views/partials/admin-list-toolbar.ejs'),
    {
      adminPath: '/private',
      section: 'returns',
      filters,
      sorts: null,
      searchMax: 60,
      searchHint: 'Order',
      icon: () => '',
      fields: [
        {
          key: 'status',
          label: 'Status',
          clearValue: 'all',
          options: [
            ['all', 'All'],
            ['approved', 'Approved'],
          ],
        },
      ],
      link: linkBuilder('/private/returns', filters),
    },
  );
  const links = [...html.matchAll(/href="([^"]+)"/g)].map(
    (m) => new URL(m[1].replaceAll('&amp;', '&'), 'http://test'),
  );
  const clear = links.find(
    (url) =>
      url.searchParams.get('status') === 'all' && !url.searchParams.has('q'),
  );
  assert.ok(clear);
  assert.equal(clear.searchParams.get('limit'), '100');
  assert.equal(clear.searchParams.has('page'), false);
  assert.match(html, /value="approved" selected/);
});
