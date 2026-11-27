const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('wallet retry references survive a section remount and clear after confirmed success', async () => {
  const storage = new Map();
  const requests = [];
  let succeed = false;
  let reloads = 0;
  function mount(userId = 'customer-a', amount = '100') {
    let submit;
    const form = {
      dataset: {userId},
      elements: {
        type: {value: 'credit'},
        amount: {value: amount},
        reason: {value: 'Test correction'},
      },
      reportValidity: () => true,
      querySelector: () => ({}),
      addEventListener: (name, callback) => {
        if (name === 'submit') submit = callback;
      },
    };
    const root = {
      querySelector: (selector) =>
        selector === 'h1' ? {textContent: 'Test shopper'} : form,
    };
    const context = {
      crypto: require('node:crypto').webcrypto,
      sessionStorage: {
        getItem: (key) => storage.get(key) || null,
        setItem: (key, value) => storage.set(key, value),
        removeItem: (key) => storage.delete(key),
      },
      window: {
        NxPages: {define: (name, setup) => setup(root, {aborted: false})},
        NxNav: {
          reload: async () => {
            reloads++;
          },
        },
      },
      Nx: {
        clearErrors() {},
        busy() {},
        toast() {},
        showErrors() {},
        formAlert() {},
        confirm: async () => true,
        submitForm: async (actualForm, request) => {
          requests.push(request.body);
          return succeed ? {message: 'Saved'} : null;
        },
      },
    };
    vm.runInNewContext(
      fs.readFileSync(
        path.join(__dirname, '../public/js/admin-wallet.js'),
        'utf8',
      ),
      context,
    );
    return () => submit({preventDefault() {}});
  }
  await mount()();
  await mount()();
  assert.equal(requests[0].requestId, requests[1].requestId);
  await mount('customer-b')();
  assert.notEqual(requests[2].requestId, requests[0].requestId);
  await mount('customer-a', '200')();
  assert.notEqual(requests[3].requestId, requests[0].requestId);
  succeed = true;
  await mount('customer-a', '200')();
  assert.equal(requests[4].requestId, requests[3].requestId);
  assert.equal(storage.has('nx:wallet-adjust:customer-a'), false);
  assert.equal(reloads, 1);
});
