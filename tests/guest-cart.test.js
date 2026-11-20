// Guest cart: the cart page is open to guests (their cart lives in the browser), but not to expired sessions.
const test = require('node:test');
const assert = require('node:assert/strict');
const {shopperPage} = require('../middleware/auth');

function fakeRes() {
  return {
    redirected: null,
    redirect(url) {
      this.redirected = url;
    },
  };
}

test('guest cart: a guest reaches the cart page', () => {
  let reached = false;
  const res = fakeRes();
  shopperPage({cookies: {}}, res, () => {
    reached = true;
  });
  assert.equal(reached, true);
  assert.equal(res.redirected, null);
});

test('guest cart: a customer reaches the cart page', () => {
  let reached = false;
  shopperPage({user: {role: 'customer'}}, fakeRes(), () => {
    reached = true;
  });
  assert.equal(reached, true);
});

test('guest cart: an expired session is sent to sign in, not shown an empty cart', () => {
  let reached = false;
  const res = fakeRes();
  shopperPage(
    {
      authProblem: 'expired',
      cookies: {},
      originalUrl: '/cart',
      path: '/cart',
      method: 'GET',
    },
    res,
    () => {
      reached = true;
    },
  );
  assert.equal(reached, false);
  assert.ok(
    res.redirected && res.redirected.startsWith('/login'),
    String(res.redirected),
  );
});
