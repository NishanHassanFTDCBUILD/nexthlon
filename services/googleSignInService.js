// Continue with Google (OAuth 2.0, authorization code). Off until GOOGLE_CLIENT_ID and
// GOOGLE_CLIENT_SECRET are set, and SITE_URL is the public address (the redirect must match exactly).
//
//   enabled()           the three settings are present
//   authUrl(state)      the Google page the shopper goes to
//   signInWith(code)    trades the code for the verified email, then finds or creates the customer account
//
// Only a verified Google email is accepted. A staff or blocked account is never signed in this way.
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const config = require('../config/env');
const User = require('../models/User');
const referralService = require('./referralService');
const {HttpError} = require('../utils/http');

const TIMEOUT_MS = 8000;

function enabled() {
  return Boolean(
    config.google.clientId && config.google.clientSecret && config.siteUrl,
  );
}

const redirectUri = () => `${config.siteUrl}/api/auth/google/callback`;

function authUrl(state) {
  const params = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

async function profileFrom(code) {
  const tokenBody = new URLSearchParams({
    code,
    client_id: config.google.clientId,
    client_secret: config.google.clientSecret,
    redirect_uri: redirectUri(),
    grant_type: 'authorization_code',
  });
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {'content-type': 'application/x-www-form-urlencoded'},
    body: tokenBody,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!tokenRes.ok)
    throw new HttpError(400, 'Google sign-in did not finish. Try again.');
  const {access_token: accessToken} = await tokenRes.json();

  const infoRes = await fetch(
    'https://openidconnect.googleapis.com/v1/userinfo',
    {
      headers: {authorization: `Bearer ${accessToken}`},
      signal: AbortSignal.timeout(TIMEOUT_MS),
    },
  );
  if (!infoRes.ok)
    throw new HttpError(400, 'Google sign-in did not finish. Try again.');
  const info = await infoRes.json();
  if (!info.email || info.email_verified !== true)
    throw new HttpError(400, 'Google did not confirm this email address.');
  const email = String(info.email).trim().toLowerCase();
  const name = String(info.name || email.split('@')[0])
    .trim()
    .slice(0, 60);
  return {email, name};
}

async function signInWith(code) {
  const {email, name} = await profileFrom(code);
  const existing = await User.findOne({email});
  if (existing) {
    if (existing.role !== 'customer')
      throw new HttpError(403, 'This account cannot sign in to the store.');
    if (existing.isBlocked)
      throw new HttpError(403, 'Your account has been blocked.');
    if (!existing.emailVerifiedAt) {
      existing.emailVerifiedAt = new Date();
      await existing.save();
    }
    return existing;
  }
  // A new account with no password: a long random one nobody knows, so only Google can sign in.
  const passwordHash = await bcrypt.hash(
    crypto.randomBytes(32).toString('hex'),
    10,
  );
  return User.create({
    name,
    email,
    passwordHash,
    role: 'customer',
    emailVerifiedAt: new Date(),
    referralCode: referralService.makeCode(name),
  });
}

module.exports = {enabled, authUrl, signInWith};
