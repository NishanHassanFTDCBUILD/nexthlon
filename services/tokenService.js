const jwt = require('jsonwebtoken');
const config = require('../config/env');

const ISSUER = 'nexthlon';

// The one path the refresh cookie is sent to. Because the cookie's path is this exact URL, the
// browser leaves it out of every other request, so the long-lived token is almost never on the wire.
const REFRESH_PATH = '/api/auth/refresh';

// Customers and admins have separate sessions: their own cookies, their own JWT audience and
// their own lifetimes. A customer token can never open the admin console, and an admin token is
// never read by the store. The admin cookies are SameSite=Strict, so other sites can't send them.
//
// Each session uses three cookies:
//   cookie         the ACCESS token (a short-lived JWT). Sent on every request.
//   refreshCookie  the REFRESH token (a long-lived random string). Sent only to REFRESH_PATH.
//   sessionCookie  the family id. Not a key and grants nothing: it only lets the account page say
//                  "this device" in the list of logged-in devices.
const KINDS = {
  customer: {
    cookie: 'nx_token',
    refreshCookie: 'nx_refresh',
    sessionCookie: 'nx_sid',
    audience: 'nexthlon-web',
    sameSite: 'lax',
    accessMaxAge: config.accessExpiresInMs,
    refreshExpiresInMs: config.refreshExpiresInMs,
  },
  admin: {
    cookie: 'nx_admin',
    refreshCookie: 'nx_admin_refresh',
    sessionCookie: 'nx_admin_sid',
    audience: 'nexthlon-admin',
    sameSite: 'strict',
    accessMaxAge: config.accessExpiresInMs,
    refreshExpiresInMs: config.adminRefreshExpiresInMs,
  },
};
const COOKIE_NAME = KINDS.customer.cookie;
const ADMIN_COOKIE_NAME = KINDS.admin.cookie;

const kindOf = (user) => (user.role === 'admin' ? 'admin' : 'customer');

// The token holds only the user id, role and token version. Nothing secret goes inside a JWT,
// because anyone can read its contents. The signature only stops it from being changed.
function signToken(user) {
  const kind = KINDS[kindOf(user)];
  return jwt.sign(
    {role: user.role, ver: user.tokenVersion || 0},
    config.jwtSecret,
    {
      subject: String(user._id),
      expiresIn: config.accessExpiresIn,
      issuer: ISSUER,
      audience: kind.audience,
      algorithm: 'HS256',
    },
  );
}

// Throws if the token is fake, changed, expired or made for the other kind of session.
function verifyToken(token, kind = 'customer') {
  return jwt.verify(token, config.jwtSecret, {
    algorithms: ['HS256'],
    issuer: ISSUER,
    audience: KINDS[kind].audience,
  });
}

function cookieOptions(kind, path = '/') {
  return {
    httpOnly: true,
    sameSite: KINDS[kind].sameSite,
    secure: config.cookieSecure,
    path,
  };
}

// ---------- Access token cookie ----------

// httpOnly means browser JavaScript cannot read the token, which protects it from XSS.
function setAuthCookie(res, token, kind = 'customer') {
  res.cookie(KINDS[kind].cookie, token, {
    ...cookieOptions(kind),
    maxAge: KINDS[kind].accessMaxAge,
  });
}

function clearAuthCookie(res, kind = 'customer') {
  res.clearCookie(KINDS[kind].cookie, cookieOptions(kind));
}

// ---------- Refresh token cookie ----------

// Same protections as the access cookie, plus the narrow path.
function setRefreshCookie(res, rawToken, kind = 'customer') {
  res.cookie(KINDS[kind].refreshCookie, rawToken, {
    ...cookieOptions(kind, REFRESH_PATH),
    maxAge: KINDS[kind].refreshExpiresInMs,
  });
}

function clearRefreshCookie(res, kind = 'customer') {
  res.clearCookie(KINDS[kind].refreshCookie, cookieOptions(kind, REFRESH_PATH));
}

function readRefreshCookie(req, kind = 'customer') {
  return (req.cookies && req.cookies[KINDS[kind].refreshCookie]) || '';
}

// ---------- Session (family) label ----------

function setSessionCookie(res, familyId, kind = 'customer') {
  res.cookie(KINDS[kind].sessionCookie, familyId, {
    ...cookieOptions(kind),
    maxAge: KINDS[kind].refreshExpiresInMs,
  });
}

function clearSessionCookie(res, kind = 'customer') {
  res.clearCookie(KINDS[kind].sessionCookie, cookieOptions(kind));
}

function readSessionCookie(req, kind = 'customer') {
  return (req.cookies && req.cookies[KINDS[kind].sessionCookie]) || '';
}

// ---------- Whole session ----------

// Signing in, and every renewal: write all three cookies in one place so they can never drift apart.
function startSession(res, {user, refreshToken, familyId}) {
  const kind = kindOf(user);
  const token = signToken(user);
  setAuthCookie(res, token, kind);
  setRefreshCookie(res, refreshToken, kind);
  setSessionCookie(res, familyId, kind);
  return token;
}

// Signing out: remove all three. The refresh token row is revoked separately, in the service.
function endSession(res, kind = 'customer') {
  clearAuthCookie(res, kind);
  clearRefreshCookie(res, kind);
  clearSessionCookie(res, kind);
}

// Only what other files (and the tests) actually use. The single-cookie writers stay private:
// callers go through startSession / endSession, so the three cookies can never drift apart.
module.exports = {
  COOKIE_NAME,
  ADMIN_COOKIE_NAME,
  REFRESH_PATH,
  KINDS,
  signToken,
  verifyToken,
  setAuthCookie,
  clearAuthCookie,
  setRefreshCookie,
  readRefreshCookie,
  readSessionCookie,
  startSession,
  endSession,
};
