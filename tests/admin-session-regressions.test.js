require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function browser(fetch) {
  const redirects = [];
  const window = {
    location: {
      href: 'http://example.test/private/products/123/edit',
      pathname: '/private/products/123/edit',
      search: '',
      replace: (url) => redirects.push(url),
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
  return {Nx: window.Nx, redirects};
}
const response = (status, data = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {'Content-Type': 'application/json'},
  });

test('binary exports renew expired access and retain the server filename and exact bytes', async () => {
  let calls = 0;
  const {Nx, redirects} = browser(async (url) => {
    if (url === '/api/auth/refresh') return response(200);
    calls++;
    return calls === 1
      ? response(401)
      : new Response('name,stock\nShoe,4\n', {
          headers: {
            'Content-Type': 'text/csv',
            'Content-Disposition':
              "attachment; filename*=UTF-8''stock%20report.csv",
          },
        });
  });
  const file = await Nx.download('/api/admin/inventory/export.csv');
  assert.equal(calls, 2);
  assert.equal(file.filename, 'stock report.csv');
  assert.equal(await file.blob.text(), 'name,stock\nShoe,4\n');
  assert.deepEqual(redirects, []);
});

test('exports never turn permission errors or sign-in HTML into downloaded files', async () => {
  for (const reply of [
    response(403, {message: 'Your role does not allow this.'}),
    new Response('<html>Sign in</html>', {
      headers: {'Content-Type': 'text/html'},
    }),
  ]) {
    const {Nx, redirects} = browser(async () => reply);
    await assert.rejects(
      Nx.download('/api/admin/reports/sales.csv'),
      /role does not allow|instead of a file/,
    );
    assert.deepEqual(redirects, []);
  }
});

test('binary downloads cannot send cookies to another origin', async () => {
  const {Nx} = browser(() =>
    assert.fail('cross-origin downloads must not fetch'),
  );
  await assert.rejects(
    Nx.download('https://outside.invalid/export.csv'),
    /must come from Nexthlon/,
  );
});

test('expired admin product uploads renew the admin session and retry the same multipart form', async () => {
  const calls = [];
  const {Nx, redirects} = browser(async (url, options) => {
    calls.push({url, ...options});
    return url === '/api/auth/refresh'
      ? response(200)
      : response(calls.length === 1 ? 401 : 200, {saved: true});
  });
  const body = new FormData();
  body.append('name', 'Updated shoes');
  assert.equal(
    (await Nx.api('/api/admin/products/123', {method: 'PATCH', body})).saved,
    true,
  );
  assert.deepEqual(JSON.parse(calls[1].body), {scope: 'admin'});
  assert.equal(calls[0].body, body);
  assert.equal(calls[2].body, body);
  assert.equal(calls[2].headers['Content-Type'], undefined);
  assert.deepEqual(redirects, []);
});

test('temporary renewal failures preserve the editor instead of redirecting to login', async () => {
  for (const status of [429, 500, 503, 0]) {
    const {Nx, redirects} = browser(async (url) => {
      if (url !== '/api/auth/refresh') return response(401);
      if (!status) throw new Error('Connection dropped');
      return response(status, {message: 'Try again shortly.'});
    });
    await assert.rejects(
      Nx.api('/api/admin/products/123', {
        method: 'PATCH',
        body: new FormData(),
      }),
      (error) => error.status === status,
    );
    assert.deepEqual(redirects, []);
  }
});

test('video uploads renew expired admin sessions and resend the original file', async () => {
  const calls = [];
  const {Nx} = browser(async (url, options) => {
    calls.push({url, ...options});
    return response(calls.length === 1 ? 401 : 200, {
      videoUrl: '/uploads/products/videos/test.mp4',
    });
  });
  const body = new FormData();
  body.append('video', new Blob(['test'], {type: 'video/mp4'}), 'test.mp4');
  const result = await Nx.api('/api/admin/products/123/video', {
    method: 'POST',
    body,
  });
  assert.equal(calls[1].url, '/api/auth/refresh');
  assert.equal(calls[0].body, body);
  assert.equal(calls[2].body, body);
  assert.equal(result.videoUrl, '/uploads/products/videos/test.mp4');
});

test('concurrent product and notification requests share one renewal; revoked sessions still sign out', async () => {
  let renewals = 0;
  let renewed = false;
  const {Nx, redirects} = browser(async (url) => {
    if (url === '/api/auth/refresh') {
      renewals++;
      await new Promise((r) => setImmediate(r));
      renewed = true;
      return response(200);
    }
    return response(renewed ? 200 : 401);
  });
  await Promise.all([
    Nx.api('/api/admin/products/123'),
    Nx.api('/api/admin/notifications'),
  ]);
  assert.equal(renewals, 1);
  assert.deepEqual(redirects, []);
  const expired = browser(async () => response(401));
  await assert.rejects(
    expired.Nx.api('/api/admin/products/123'),
    (error) => error.status === 401,
  );
  assert.match(expired.redirects[0], /^\/private\/login\?/);
});

test('store visits and missing images preserve admin cookies and the following product save', async (t) => {
  const User = require('../models/User');
  const user = new User({
    _id: '000000000000000000000009',
    name: 'Test Admin',
    email: 'admin@example.test',
    role: 'admin',
    adminRole: 'owner',
  });
  t.mock.method(User, 'findById', async () => user);
  t.mock.method(
    require('../services/categoryService'),
    'listedCategories',
    async () => [],
  );
  const revocations = t.mock.method(
    require('../services/refreshTokenService'),
    'revokeFamily',
    async () => 1,
  );
  const product = {
    id: '000000000000000000000001',
    name: 'Training shoes',
    price: 100000,
    mrp: 120000,
    stock: 5,
    isListed: true,
  };
  t.mock.method(
    require('../services/adminProductService'),
    'getAdminProduct',
    async () => product,
  );
  const update = t.mock.method(
    require('../services/adminProductService'),
    'updateProduct',
    async () => product,
  );
  t.mock.method(require('../services/auditService'), 'record', async () => {});
  t.mock.method(require('../services/stockAlertService'), 'kick', () => {});
  const app = require('../app');
  const server = await new Promise((resolve) => {
    const value = app.listen(0, '127.0.0.1', () => resolve(value));
  });
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const token = require('../services/tokenService').signToken(user);
  const cookie = `nx_admin=${token}; nx_admin_sid=test-admin-family`;
  for (const url of ['/about', '/img/missing-product-preview.webp']) {
    const result = await fetch(base + url, {headers: {Cookie: cookie}});
    assert.equal(result.status, url === '/about' ? 200 : 404);
    assert.equal(
      result.headers
        .getSetCookie()
        .some((value) => value.startsWith('nx_admin')),
      false,
    );
  }
  assert.equal(revocations.mock.callCount(), 0);
  const body = new FormData();
  body.append('name', 'Training shoes');
  const saved = await fetch(base + '/api/admin/products/' + product.id, {
    method: 'PATCH',
    headers: {Cookie: cookie, Origin: base},
    body,
  });
  assert.equal(saved.status, 200, await saved.text());
  assert.equal(update.mock.callCount(), 1);
  const logout = await fetch(base + '/api/admin/logout', {
    method: 'POST',
    headers: {Cookie: cookie, Origin: base},
  });
  assert.equal(logout.status, 200);
  assert.equal(revocations.mock.callCount(), 1);
  assert.ok(
    logout.headers
      .getSetCookie()
      .some((value) => value.startsWith('nx_admin=')),
  );
});
