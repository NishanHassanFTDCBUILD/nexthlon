const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function browser(fetch) {
  const window = {
    location: {
      href: 'http://example.test/private/staff',
      pathname: '/private/staff',
      search: '',
      replace() {},
    },
  };
  const source = fs
    .readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8')
    .split('// ---------- Toasts ----------')[0];
  vm.runInNewContext(source + '\n})();', {
    window,
    document: {body: {dataset: {adminPath: '/private'}}},
    fetch,
    Intl,
    URL,
    URLSearchParams,
    FormData,
    AbortController,
    setTimeout,
    clearTimeout,
  });
  return window.Nx;
}
const response = (status = 200) =>
  new Response(JSON.stringify({message: 'Saved'}), {
    status,
    headers: {'Content-Type': 'application/json'},
  });

test('repeated clicks share one admin write and release navigation before refreshing', async () => {
  let finish;
  let calls = 0;
  const Nx = browser(() => {
    calls++;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const options = {method: 'PATCH', body: {role: 'packing'}};
  const first = Nx.api('/api/admin/staff/123/role', options);
  const second = Nx.api('/api/admin/staff/123/role', options);
  assert.equal(calls, 1);
  assert.equal(Nx.hasPendingAdminWrites(), true);
  finish(response());
  await Promise.all([first, second]);
  assert.equal(Nx.hasPendingAdminWrites(), false);
  const next = Nx.api('/api/admin/staff/123/role', options);
  assert.equal(calls, 2, 'later intentional actions are not suppressed');
  finish(response());
  await next;
});

test('concurrent changes keep navigation locked until every admin write finishes', async () => {
  const replies = [];
  const Nx = browser(() => new Promise((resolve) => replies.push(resolve)));
  const first = Nx.api('/api/admin/staff/123/role', {
    method: 'PATCH',
    body: {role: 'packing'},
  });
  const second = Nx.api('/api/admin/staff/456/role', {
    method: 'PATCH',
    body: {role: 'support'},
  });
  replies[0](response());
  await first;
  assert.equal(Nx.hasPendingAdminWrites(), true);
  replies[1](response());
  await second;
  assert.equal(Nx.hasPendingAdminWrites(), false);
});

test('failed writes unlock navigation and can be retried with the same input', async () => {
  let calls = 0;
  const Nx = browser(async () => response(++calls === 1 ? 500 : 200));
  const options = {
    method: 'POST',
    body: {requestId: 'wallet-test', amount: 10},
  };
  await assert.rejects(
    Nx.api('/api/admin/customers/123/wallet/adjust', options),
  );
  assert.equal(Nx.hasPendingAdminWrites(), false);
  await Nx.api('/api/admin/customers/123/wallet/adjust', options);
  assert.equal(calls, 2);
});

test('read requests do not lock navigation or block independent dashboard requests', async () => {
  let calls = 0;
  const replies = [];
  const Nx = browser(() => {
    calls++;
    return new Promise((resolve) => replies.push(resolve));
  });
  const requests = [
    Nx.api('/api/admin/notifications'),
    Nx.api('/api/admin/notifications'),
  ];
  assert.equal(calls, 2);
  assert.equal(Nx.hasPendingAdminWrites(), false);
  replies.forEach((resolve) => resolve(response()));
  await Promise.all(requests);
});

test('uploads retain their original files and independent forms are not merged', async () => {
  const replies = [];
  const bodies = [];
  const Nx = browser((url, options) => {
    bodies.push(options.body);
    return new Promise((resolve) => replies.push(resolve));
  });
  const firstBody = new FormData();
  firstBody.append('image', new Blob(['first']), 'first.png');
  const secondBody = new FormData();
  secondBody.append('image', new Blob(['second']), 'second.png');
  const requests = [
    Nx.api('/api/admin/products', {method: 'POST', body: firstBody}),
    Nx.api('/api/admin/products', {method: 'POST', body: secondBody}),
  ];
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0], firstBody);
  assert.equal(bodies[1], secondBody);
  assert.equal(Nx.hasPendingAdminWrites(), true);
  replies.forEach((resolve) => resolve(response()));
  await Promise.all(requests);
  assert.equal(Nx.hasPendingAdminWrites(), false);
});
