const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function formBrowser(api) {
  const source = fs.readFileSync(
    path.join(__dirname, '../public/js/app.js'),
    'utf8',
  );
  const Nx = {
    api,
    clearErrors() {},
    busy() {},
    showErrors() {},
    formAlert: () => true,
  };
  const events = [];
  const form = {
    dataset: {unsaved: 'true'},
    querySelector: () => ({}),
    dispatchEvent: (event) => events.push(event.type),
  };
  vm.runInNewContext(
    source.slice(
      source.indexOf('const submittingForms ='),
      source.indexOf('// ---------- Motion helpers'),
    ),
    {
      Nx,
      document: {body: {dataset: {adminPath: '/private'}}},
      CustomEvent: class {
        constructor(type) {
          this.type = type;
        }
      },
    },
  );
  return {Nx, form, events};
}

test('admin saves block navigation and duplicate submits until one request completes', async () => {
  let finish;
  let calls = 0;
  const app = formBrowser(() => {
    calls++;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const first = app.Nx.submitForm(app.form, {
    url: '/api/admin/categories',
    body: {name: 'Test'},
  });
  assert.equal(app.form.dataset.pending, 'true');
  assert.equal(
    await app.Nx.submitForm(app.form, {
      url: '/api/admin/categories',
      body: {name: 'Test'},
    }),
    null,
  );
  finish({message: 'Saved'});
  await first;
  assert.equal(calls, 1);
  assert.equal(app.form.dataset.pending, undefined);
  assert.equal(app.form.dataset.unsaved, undefined);
  assert.equal(app.form.dataset.saved, 'true');
  assert.deepEqual(app.events, ['nx:form-saved']);
});

test('failed admin saves retain unsaved input and release their lock for retry', async () => {
  let calls = 0;
  const app = formBrowser(async () => {
    if (++calls === 1) throw new Error('Temporary server error');
    return {message: 'Saved'};
  });
  const options = {url: '/api/admin/categories', body: {name: 'Test'}};
  assert.equal(await app.Nx.submitForm(app.form, options), null);
  assert.equal(app.form.dataset.unsaved, 'true');
  assert.equal(app.form.dataset.pending, undefined);
  assert.equal(app.form.dataset.saved, undefined);
  await app.Nx.submitForm(app.form, options);
  assert.equal(calls, 2);
});

test('forms capture input before locking controls and restore prior states after success or failure', async () => {
  for (const failed of [false, true]) {
    let finish;
    const app = formBrowser(
      () =>
        new Promise((resolve, reject) => {
          finish = () =>
            failed
              ? reject(new Error('Save failed'))
              : resolve({message: 'Saved'});
        }),
    );
    const controls = [{disabled: false}, {disabled: true}];
    app.Nx.showErrors = () => {
      assert.equal(
        controls[0].disabled,
        false,
        'unlock invalid fields before focusing errors',
      );
    };
    app.form.querySelectorAll = () => controls;
    app.Nx.formValues = () => {
      assert.equal(
        controls[0].disabled,
        false,
        'read values before disabling fields',
      );
      return {note: 'Original input'};
    };
    const request = app.Nx.submitForm(app.form, {
      url: '/api/admin/customers/123/note',
    });
    assert.ok(controls.every((control) => control.disabled));
    finish();
    await request;
    assert.deepEqual(
      controls.map((control) => control.disabled),
      [false, true],
    );
  }
});

function searchBrowser() {
  const element = () => ({
    value: '',
    hidden: true,
    attrs: {},
    events: {},
    addEventListener(type, handler) {
      (this.events[type] ||= []).push(handler);
    },
    setAttribute(name, value) {
      this.attrs[name] = value;
    },
    removeAttribute(name) {
      delete this.attrs[name];
    },
    querySelectorAll: () => [],
    append() {},
    blur() {},
  });
  const input = element();
  const pop = element();
  const box = {
    querySelector: (selector) =>
      selector === '[data-admin-search-input]' ? input : pop,
    contains: () => false,
  };
  const events = {};
  const timers = new Map();
  let timerId = 0;
  let requests = 0;
  let resolveSearch;
  const source = fs.readFileSync(
    path.join(__dirname, '../public/js/admin.js'),
    'utf8',
  );
  vm.runInNewContext(
    source.slice(
      source.indexOf('const cache = new Map()'),
      source.indexOf('// ---------- Ctrl+K command palette'),
    ),
    {
      document: {
        querySelector: () => box,
        addEventListener: (name, handler) => {
          events[name] = handler;
        },
      },
      Nx: {
        api: () => {
          requests++;
          return new Promise((resolve) => {
            resolveSearch = resolve;
          });
        },
        toast() {},
      },
      el: element,
      setTimeout: (callback) => {
        const id = ++timerId;
        timers.set(id, callback);
        return id;
      },
      clearTimeout: (id) => timers.delete(id),
    },
  );
  return {
    input,
    pop,
    events,
    timers,
    requests: () => requests,
    fire(type, event = {}) {
      input.events[type].forEach((handler) => handler(event));
    },
    runTimer() {
      const [id, callback] = [...timers.entries()][0];
      timers.delete(id);
      return callback();
    },
    finish() {
      resolveSearch({results: {orders: [], products: [], customers: []}});
    },
  };
}

test('a late admin search reply stays closed after Escape or clearing the query', async () => {
  for (const dismiss of ['escape', 'clear', 'outside']) {
    const app = searchBrowser();
    app.input.value = 'shoe';
    app.fire('input');
    const pending = app.runTimer();
    if (dismiss === 'escape') app.fire('keydown', {key: 'Escape'});
    if (dismiss === 'clear') {
      app.input.value = '';
      app.fire('input');
    }
    if (dismiss === 'outside') app.events.click({target: {}});
    app.finish();
    await pending;
    assert.equal(app.pop.hidden, true);
    assert.equal(app.input.attrs['aria-expanded'], 'false');
  }
});

test('Escape cancels a queued admin search before it sends a request', () => {
  const app = searchBrowser();
  app.input.value = 'shoe';
  app.fire('input');
  app.fire('keydown', {key: 'Escape'});
  assert.equal(app.timers.size, 0);
  assert.equal(app.requests(), 0);
});
