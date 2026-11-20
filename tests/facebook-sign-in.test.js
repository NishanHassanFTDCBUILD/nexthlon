// Continue with Facebook: the pieces that need no Facebook app (no network, no keys needed).
require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../config/env');
const facebookSignIn = require('../services/facebookSignInService');

test('facebook sign-in: off until the app id, secret and site address are all set', () => {
  assert.equal(typeof facebookSignIn.enabled(), 'boolean');
  const saved = {...config.facebook};
  config.facebook.appId = '';
  assert.equal(facebookSignIn.enabled(), false);
  Object.assign(config.facebook, saved);
});

test('facebook sign-in: the Facebook page asks for the email and carries the state', () => {
  const url = facebookSignIn.authUrl('state-456');
  assert.ok(url.startsWith('https://www.facebook.com/v21.0/dialog/oauth?'));
  const params = new URL(url).searchParams;
  assert.equal(params.get('state'), 'state-456');
  assert.equal(params.get('response_type'), 'code');
  assert.equal(params.get('scope'), 'email,public_profile');
  assert.match(params.get('redirect_uri'), /\/api\/auth\/facebook\/callback$/);
});
