const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function browser(fetch) {
  const location = new URL('http://example.test/private/inventory');
  const redirects = [];
  location.assign = (href) => redirects.push(href);
  location.reload = () => redirects.push('reload');
  const notices = [];
  const form = {dataset: {}};
  const timers = new Map();
  let nextTimer = 0;
  function root(page) {
    return {
      dataset: {page, section: page, pageTitle: page},
      querySelector: () => ({hasAttribute: () => true, focus() {}}),
      removeAttribute() {},
      replaceWith(next) {
        current = next;
      },
    };
  }
  let current = root('inventory');
  const main = {
    dataset: {navMain: 'admin'},
    classList: {add() {}, remove() {}},
    setAttribute() {},
    removeAttribute() {},
    querySelector(selector) {
      if (selector === '[data-page]') return current;
      if (selector.includes('data-unsaved'))
        return form.dataset.unsaved === 'true' ? form : null;
      if (selector.includes('data-pending'))
        return form.dataset.pending === 'true' ? form : null;
      if (selector.includes('data-saved'))
        return form.dataset.saved === 'true' ? form : null;
      return null;
    },
    querySelectorAll: () => (form.dataset.unsaved === 'true' ? [form] : []),
    getBoundingClientRect: () => ({top: 0}),
  };
  const document = {
    body: {dataset: {adminPath: '/private'}},
    querySelector: () => main,
    querySelectorAll: () => [],
    addEventListener() {},
    dispatchEvent() {},
    importNode: (node) => node,
    getElementById: () => null,
  };
  class DOMParser {
    parseFromString(html) {
      return {querySelector: () => (html === 'error' ? null : root(html))};
    }
  }
  const history = {
    state: {},
    pushState(state, _title, href) {
      this.state = state;
      location.href = new URL(href, location).href;
    },
    replaceState(state, _title, href) {
      this.state = state;
      location.href = new URL(href, location).href;
    },
  };
  const Nx = {
    toast: (message) => notices.push(message),
    confirm: async () => true,
    renewSession: async () => true,
  };
  const window = {
    Nx,
    location,
    fetch,
    DOMParser,
    scrollY: 0,
    scrollTo() {},
    addEventListener() {},
  };
  vm.runInNewContext(
    fs.readFileSync(
      path.join(__dirname, '../public/js/section-nav.js'),
      'utf8',
    ),
    {
      window,
      document,
      history,
      location,
      fetch,
      DOMParser,
      URL,
      URLSearchParams,
      AbortController,
      setTimeout(callback, ms) {
        const id = ++nextTimer;
        timers.set(id, {callback, ms});
        return id;
      },
      clearTimeout: (id) => timers.delete(id),
      CustomEvent: class {},
    },
  );
  return {
    nav: window.NxNav,
    Nx,
    form,
    redirects,
    notices,
    timers,
    page: () => current.dataset.page,
  };
}
const reply = (
  page,
  {status = 200, url = `http://example.test/private/${page}`, text} = {},
) => ({
  ok: status < 400,
  status,
  url,
  text: text || (async () => page),
});

test('a slow obsolete error response never replaces a newer navigation or forces a reload', async () => {
  let finishOld;
  const oldText = new Promise((resolve) => {
    finishOld = resolve;
  });
  const app = browser(async (url) =>
    url.endsWith('/orders')
      ? reply('error', {status: 404, text: () => oldText})
      : reply('products'),
  );
  const old = app.nav.go('/private/orders');
  await new Promise(setImmediate);
  await app.nav.go('/private/products');
  finishOld('error');
  await old;
  assert.equal(app.page(), 'products');
  assert.deepEqual(app.redirects, []);
});

test('temporary network and server errors keep the editor and its unsaved warning', async () => {
  for (const fetch of [
    async () => {
      throw new Error('offline');
    },
    async () => reply('error', {status: 503}),
  ]) {
    const app = browser(fetch);
    app.form.dataset.unsaved = 'true';
    await app.nav.go('/private/products');
    assert.equal(app.page(), 'inventory');
    assert.equal(app.form.dataset.unsaved, 'true');
    assert.deepEqual(app.redirects, []);
    assert.match(app.notices[0], /still here/);
  }
});

test('expired HTML navigation renews once and retries without flashing sign-in', async () => {
  let calls = 0;
  let renewals = 0;
  const app = browser(async () =>
    ++calls === 1
      ? reply('sign in', {
          url: 'http://example.test/private/login?reason=expired',
        })
      : reply('products'),
  );
  app.Nx.renewSession = async () => {
    renewals++;
    return true;
  };
  await app.nav.go('/private/products');
  assert.equal(renewals, 1);
  assert.equal(calls, 2);
  assert.equal(app.page(), 'products');
  assert.deepEqual(app.redirects, []);
});

test('a save in progress blocks section navigation', async () => {
  const app = browser(() => assert.fail('must not navigate while saving'));
  app.form.dataset.pending = 'true';
  await app.nav.go('/private/orders');
  assert.equal(app.page(), 'inventory');
  assert.match(app.notices[0], /save to finish/);
});

test('a page timeout stops waiting but preserves the current page', async () => {
  const app = browser(
    (_url, {signal}) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () =>
          reject(Object.assign(new Error('aborted'), {name: 'AbortError'})),
        );
      }),
  );
  const pending = app.nav.go('/private/orders');
  [...app.timers.values()].find((timer) => timer.ms === 20000).callback();
  await pending;
  assert.equal(app.page(), 'inventory');
  assert.match(app.notices[0], /took too long/);
  assert.equal(app.timers.size, 0);
});

test('failed navigation after a committed create leaves the create form through a full load', async () => {
  const app = browser(async () => {
    throw new Error('offline');
  });
  app.form.dataset.saved = 'true';
  await app.nav.go('/private/products');
  assert.deepEqual(app.redirects, ['http://example.test/private/products']);
});

test('malformed hash links cannot break a successful section swap', async () => {
  const app = browser(async () => reply('products'));
  await app.nav.go('/private/products#%bad');
  assert.equal(app.page(), 'products');
  assert.deepEqual(app.redirects, []);
});

test('raw admin action writes block section switches until they finish', async () => {
  let requests = 0;
  const app = browser(async () => {
    requests++;
    return reply('orders');
  });
  let pending = true;
  app.Nx.hasPendingAdminWrites = () => pending;
  await app.nav.go('/private/orders');
  assert.equal(requests, 0);
  assert.match(app.notices[0], /current save/);
  pending = false;
  await app.nav.go('/private/orders');
  assert.equal(requests, 1);
  assert.equal(app.page(), 'orders');
});
