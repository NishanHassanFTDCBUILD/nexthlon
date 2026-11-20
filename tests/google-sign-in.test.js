// Continue with Google: the pieces that need no Google account (no network, no keys needed).
// Test settings (no .env needed, as in CI).
require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const googleSignIn = require('../services/googleSignInService');

test('google sign-in: the switch is a plain yes or no', () => {
  assert.equal(typeof googleSignIn.enabled(), 'boolean');
});

test('google sign-in: the Google page asks for the verified basics and carries the state', () => {
  const url = googleSignIn.authUrl('state-123');
  assert.ok(url.startsWith('https://accounts.google.com/o/oauth2/v2/auth?'));
  const params = new URL(url).searchParams;
  assert.equal(params.get('state'), 'state-123');
  assert.equal(params.get('response_type'), 'code');
  assert.equal(params.get('scope'), 'openid email profile');
  assert.match(params.get('redirect_uri'), /\/api\/auth\/google\/callback$/);
});
