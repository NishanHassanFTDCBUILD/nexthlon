// Continue with Facebook (OAuth 2.0, authorization code). Off until FACEBOOK_APP_ID and
// FACEBOOK_APP_SECRET are set, and SITE_URL is the public address (the redirect must match exactly).
//
//   enabled()           the three settings are present
//   authUrl(state)      the Facebook page the shopper goes to
//   signInWith(code)    trades the code for the shopper's email, then finds or creates the customer account
//
// Facebook only shares an email it has confirmed. Some Facebook accounts (phone-only) have none: those
// get a clear message and can use email or Google instead.
const crypto = require('crypto');
const config = require('../config/env');
const {accountForEmail} = require('./socialAccountService');
const {HttpError} = require('../utils/http');

const TIMEOUT_MS = 8000;
const GRAPH = 'https://graph.facebook.com/v21.0';

function enabled() {
  return Boolean(
    config.facebook.appId && config.facebook.appSecret && config.siteUrl,
  );
}

const redirectUri = () => `${config.siteUrl}/api/auth/facebook/callback`;

function authUrl(state) {
  const params = new URLSearchParams({
    client_id: config.facebook.appId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: 'email,public_profile',
    state,
  });
  return `https://www.facebook.com/v21.0/dialog/oauth?${params.toString()}`;
}

const failed = () =>
  new HttpError(400, 'Facebook sign-in did not finish. Try again.');

async function profileFrom(code) {
  const tokenParams = new URLSearchParams({
    client_id: config.facebook.appId,
    client_secret: config.facebook.appSecret,
    redirect_uri: redirectUri(),
    code,
  });
  const tokenRes = await fetch(`${GRAPH}/oauth/access_token?${tokenParams}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!tokenRes.ok) throw failed();
  const {access_token: accessToken} = await tokenRes.json();
  if (!accessToken) throw failed();

  // appsecret_proof: Facebook only answers calls signed with the app secret (set "Require App Secret").
  const proof = crypto
    .createHmac('sha256', config.facebook.appSecret)
    .update(accessToken)
    .digest('hex');
  const meParams = new URLSearchParams({
    fields: 'id,name,email',
    appsecret_proof: proof,
  });
  const meRes = await fetch(`${GRAPH}/me?${meParams}`, {
    headers: {authorization: `Bearer ${accessToken}`},
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!meRes.ok) throw failed();
  const info = await meRes.json();
  if (!info.email)
    throw new HttpError(
      400,
      'Facebook did not share an email address.',
      {},
      'no_email',
    );
  const email = String(info.email).trim().toLowerCase();
  const name = String(info.name || email.split('@')[0])
    .trim()
    .slice(0, 60);
  return {email, name};
}

async function signInWith(code) {
  return accountForEmail(await profileFrom(code));
}

module.exports = {enabled, authUrl, signInWith};
