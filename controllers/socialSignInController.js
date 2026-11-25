// The start redirect and the callback for "Continue with Google" and "Continue with Facebook".
// Both work the same way; only the service (Google or Facebook) differs.
//
//   start      a random state goes in a short cookie, and the shopper goes to the provider
//   callback   the state must match the cookie, or nothing is signed in
const crypto = require('crypto');
const config = require('../config/env');
const authService = require('../services/authService');
const refreshTokenService = require('../services/refreshTokenService');
const {startSession} = require('../services/tokenService');
const {asyncHandler, safeNextPath} = require('../utils/http');

function socialSignIn(name, service) {
  const stateCookie = `nx_${name}_state`;
  const nextCookie = `nx_${name}_next`;
  const statePath = `/api/auth/${name}`;

  const start = (req, res) => {
    if (!service.enabled()) return res.status(404).end();
    const state = crypto.randomBytes(16).toString('hex');
    res.cookie(stateCookie, state, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.cookieSecure,
      maxAge: 10 * 60 * 1000,
      path: statePath,
    });
    res.cookie(nextCookie, safeNextPath(req.query?.next, '/account'), {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.cookieSecure,
      maxAge: 10 * 60 * 1000,
      path: statePath,
    });
    return res.redirect(service.authUrl(state));
  };

  const callback = asyncHandler(async (req, res) => {
    if (!service.enabled()) return res.status(404).end();
    const saved = req.cookies && req.cookies[stateCookie];
    const next = safeNextPath(req.cookies?.[nextCookie], '/account');
    res.clearCookie(stateCookie, {path: statePath});
    res.clearCookie(nextCookie, {path: statePath});
    const {state, code} = req.query;
    if (
      !saved ||
      typeof state !== 'string' ||
      state !== saved ||
      typeof code !== 'string'
    )
      return res.redirect(`/login?reason=${name}`);

    let user;
    try {
      user = await service.signInWith(code);
    } catch (error) {
      const reason =
        error.status === 403
          ? 'blocked'
          : error.reason === 'no_email'
            ? `${name}_no_email`
            : name;
      return res.redirect(`/login?reason=${reason}`);
    }
    await authService.touchLogin(user);
    const {rawToken, familyId} = await refreshTokenService.issue(
      user,
      refreshTokenService.deviceFrom(req),
    );
    startSession(res, {user, refreshToken: rawToken, familyId});
    return res.redirect(next);
  });

  return {start, callback};
}

module.exports = {socialSignIn};
