require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');
const {socialSignIn} = require('../controllers/socialSignInController');
const router = require('../routes/authRoutes');

function response() {
  return {
    cookies: [],
    cleared: [],
    cookie(...args) {
      this.cookies.push(args);
    },
    clearCookie(...args) {
      this.cleared.push(args);
    },
    redirect(url) {
      this.location = url;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    end() {
      this.ended = true;
    },
  };
}

for (const provider of ['google', 'facebook']) {
  test(`${provider}: start and callback routes match the provider redirect URI`, () => {
    for (const suffix of ['', '/callback']) {
      assert.ok(
        router.stack.some(
          ({route}) =>
            route?.path === `/auth/${provider}${suffix}` && route.methods.get,
        ),
      );
    }
  });

  test(`${provider}: start sets a private, expiring state cookie`, () => {
    const handlers = socialSignIn(provider, {
      enabled: () => true,
      authUrl: (state) => `https://provider.test/?state=${state}`,
    });
    const res = response();
    handlers.start({}, res);
    const [name, state, options] = res.cookies[0];
    assert.equal(name, `nx_${provider}_state`);
    assert.match(state, /^[a-f0-9]{32}$/);
    assert.equal(options.httpOnly, true);
    assert.equal(options.sameSite, 'lax');
    assert.equal(options.path, `/api/auth/${provider}`);
    assert.equal(options.maxAge, 600000);
    assert.ok(res.location.includes(state));
  });

  test(`${provider}: forged or missing callback state cannot sign in`, async () => {
    let called = false;
    const handlers = socialSignIn(provider, {
      enabled: () => true,
      signInWith: () => {
        called = true;
      },
    });
    for (const query of [
      {code: 'code'},
      {state: 'forged', code: 'code'},
      {state: 'saved', code: ['one', 'two']},
    ]) {
      const res = response();
      await handlers.callback(
        {cookies: {[`nx_${provider}_state`]: 'saved'}, query},
        res,
        (error) => {
          throw error;
        },
      );
      assert.equal(res.location, `/login?reason=${provider}`);
      assert.equal(called, false);
      assert.equal(res.cleared[0][0], `nx_${provider}_state`);
    }
  });

  test(`${provider}: disabled provider does not start authentication`, () => {
    const res = response();
    socialSignIn(provider, {enabled: () => false}).start({}, res);
    assert.equal(res.statusCode, 404);
    assert.equal(res.cookies.length, 0);
  });

  test(`${provider}: remembers a local destination and rejects external redirects`, () => {
    const handlers = socialSignIn(provider, {
      enabled: () => true,
      authUrl: () => 'https://provider.test/',
    });
    for (const [next, expected] of [
      ['/checkout', '/checkout'],
      ['https://evil.example', '/account'],
      ['//evil.example', '/account'],
      ['/api/logout', '/account'],
    ]) {
      const res = response();
      handlers.start({query: {next}}, res);
      const cookie = res.cookies.find(
        ([name]) => name === `nx_${provider}_next`,
      );
      assert.equal(cookie[1], expected);
      assert.equal(cookie[2].httpOnly, true);
    }
  });
}

test('social buttons appear on both forms, only for configured providers', () => {
  const template = fs.readFileSync(
    path.join(__dirname, '../views/partials/auth-social.ejs'),
    'utf8',
  );
  const render = (googleSignIn, facebookSignIn) =>
    ejs.render(template, {
      googleSignIn,
      facebookSignIn,
      label: 'Continue with',
    });
  assert.doesNotMatch(render(false, false), /href=/);
  assert.match(render(true, false), /href="\/api\/auth\/google"/);
  assert.doesNotMatch(render(true, false), /href="\/api\/auth\/facebook"/);
  assert.match(render(false, true), /href="\/api\/auth\/facebook"/);
  const page = fs.readFileSync(
    path.join(__dirname, '../views/pages/auth.ejs'),
    'utf8',
  );
  assert.equal(
    [...page.matchAll(/include\('\.\.\/partials\/auth-social'/g)].length,
    2,
  );
});

test('social accounts reject staff and blocked customers', async (t) => {
  const User = require('../models/User');
  const {accountForEmail} = require('../services/socialAccountService');
  for (const account of [
    {role: 'admin'},
    {role: 'customer', isBlocked: true},
  ]) {
    const lookup = t.mock.method(User, 'findOne', async () => account);
    await assert.rejects(
      accountForEmail({email: 'shopper@example.test', name: 'Shopper'}),
      {status: 403},
    );
    lookup.mock.restore();
  }
});

test('valid social callback starts a customer session and returns to checkout', async (t) => {
  const auth = require('../services/authService');
  const refresh = require('../services/refreshTokenService');
  const {verifyToken} = require('../services/tokenService');
  const user = {_id: '507f1f77bcf86cd799439011', role: 'customer'};
  t.mock.method(auth, 'touchLogin', async (value) => assert.equal(value, user));
  t.mock.method(refresh, 'issue', async (value) => {
    assert.equal(value, user);
    return {rawToken: 'test-refresh-token', familyId: 'test-family'};
  });
  t.mock.method(refresh, 'deviceFrom', () => ({}));
  const res = response();
  const handlers = socialSignIn('google', {
    enabled: () => true,
    signInWith: async (code) => {
      assert.equal(code, 'test-code');
      return user;
    },
  });
  await handlers.callback(
    {
      cookies: {nx_google_state: 'saved', nx_google_next: '/checkout'},
      query: {state: 'saved', code: 'test-code'},
    },
    res,
    (error) => {
      throw error;
    },
  );
  assert.equal(res.location, '/checkout');
  const token = res.cookies.find(([name]) => name === 'nx_token');
  assert.equal(verifyToken(token[1]).sub, user._id);
  assert.equal(token[2].httpOnly, true);
  assert.equal(
    res.cookies.find(([name]) => name === 'nx_refresh')[1],
    'test-refresh-token',
  );
});
