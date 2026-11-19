// Continue with Google: the start redirect and the callback (see services/googleSignInService.js).
const crypto = require('crypto');
const config = require('../config/env');
const googleSignIn = require('../services/googleSignInService');
const authService = require('../services/authService');
const refreshTokenService = require('../services/refreshTokenService');
const {startSession} = require('../services/tokenService');
const {asyncHandler} = require('../utils/http');

const STATE_COOKIE = 'nx_google_state';
const STATE_PATH = '/api/auth/google';

// GET /api/auth/google: a random state goes in a short cookie, and the shopper goes to Google.
const start = (req, res) => {
  if (!googleSignIn.enabled()) return res.status(404).end();
  const state = crypto.randomBytes(16).toString('hex');
  res.cookie(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    maxAge: 10 * 60 * 1000,
    path: STATE_PATH,
  });
  return res.redirect(googleSignIn.authUrl(state));
};

// GET /api/auth/google/callback: the state must match the cookie, or nothing is signed in.
const callback = asyncHandler(async (req, res) => {
  if (!googleSignIn.enabled()) return res.status(404).end();
  const saved = req.cookies && req.cookies[STATE_COOKIE];
  res.clearCookie(STATE_COOKIE, {path: STATE_PATH});
  const {state, code} = req.query;
  if (
    !saved ||
    typeof state !== 'string' ||
    state !== saved ||
    typeof code !== 'string'
  )
    return res.redirect('/login?reason=google');

  let user;
  try {
    user = await googleSignIn.signInWith(code);
  } catch (error) {
    const reason = error.status === 403 ? 'blocked' : 'google';
    return res.redirect(`/login?reason=${reason}`);
  }
  await authService.touchLogin(user);
  const {rawToken, familyId} = await refreshTokenService.issue(
    user,
    refreshTokenService.deviceFrom(req),
  );
  startSession(res, {user, refreshToken: rawToken, familyId});
  return res.redirect('/account');
});

module.exports = {start, callback};
