const crypto = require('crypto');
const authService = require('../services/authService');
const adminTwoFactor = require('../services/adminTwoFactorService');
const mailService = require('../services/mailService');
const User = require('../models/User');
const {renderEmail, siteUrl} = require('../utils/emailLayout');
const refreshTokenService = require('../services/refreshTokenService');
const {
  startSession,
  endSession,
  readRefreshCookie,
  readSessionCookie,
  signToken,
  setAuthCookie,
} = require('../services/tokenService');
const emailVerificationService = require('../services/emailVerificationService');
const {siteUrlFor} = require('../utils/emailLayout');
const {
  validateSignup,
  validateLogin,
  hasErrors,
} = require('../utils/validators');
const {HttpError, asyncHandler} = require('../utils/http');
const {formatPaise} = require('../utils/money');
const accountService = require('../services/accountService');
const logger = require('../utils/logger');
const {toPublicUser} = require('../utils/publicUser');
const cartService = require('../services/cartService');
const {readGuestCart, clearGuestCart} = require('../middleware/guestCart');

// Adds the sign-in to the account's login activity (browser and masked IP). Never blocks signing in.
async function noteLogin(req, user) {
  try {
    await accountService.recordLogin(user._id, {
      userAgent: req.get('user-agent'),
      ip: req.ip,
    });
  } catch (error) {
    logger.warn('login_activity.failed', {error});
  }
}

// What a guest put in their cart before signing in moves into the account's cart, and the guest cart
// cookie goes. Never blocks signing in: if it fails, the guest cart simply stays for next time.
// Returns a sentence for the welcome message ("" when nothing moved).
async function bringGuestCart(req, res, user) {
  const guest = readGuestCart(req);
  if (!guest) return '';
  try {
    const {moved} = await cartService.mergeGuestCart(user._id, guest);
    clearGuestCart(res);
    return moved
      ? ` The ${moved === 1 ? 'item' : 'items'} in your cart ${moved === 1 ? 'is' : 'are'} saved to your account.`
      : '';
  } catch (error) {
    logger.warn('guest_cart.merge_failed', {error});
    return '';
  }
}

// Which session a refresh request is for. The browser says "admin" only from the admin console;
// everything else is the store. Each kind has its own refresh cookie, so both can be signed in
// in one browser without clashing.
function scopeFrom(body) {
  return body && body.scope === 'admin' ? 'admin' : 'customer';
}

// Issues a brand new pair: a short-lived access token (JWT) and a long-lived refresh token, each in
// its own httpOnly cookie. The access token is also returned in the body for API tools like Postman.
async function sendSignedIn(req, res, user, status, message) {
  const {rawToken, familyId} = await refreshTokenService.issue(
    user,
    refreshTokenService.deviceFrom(req),
  );
  const token = startSession(res, {user, refreshToken: rawToken, familyId});
  res.status(status).json({message, user: toPublicUser(user), token});
}

// POST /api/signup
const signup = asyncHandler(async (req, res) => {
  const {errors, value} = validateSignup(req.body);
  if (hasErrors(errors))
    throw new HttpError(400, 'Please fix the highlighted fields.', errors);
  const user = await authService.registerCustomer(value);
  await noteLogin(req, user);
  // Ask them to confirm the address. In the background: they are signing up, not waiting for an email server.
  emailVerificationService.sendInBackground(user, {
    baseUrl: siteUrlFor(req),
    ip: req.ip,
  });
  const bonus = user.referralReward
    ? ` You and your friend each get ${formatPaise(user.referralReward)} in your wallets when your first order is delivered.`
    : '';
  const carried = await bringGuestCart(req, res, user);
  await sendSignedIn(
    req,
    res,
    user,
    201,
    `Welcome to Nexthlon! Your account is ready.${bonus}${carried}`,
  );
});

// POST /api/login
const login = asyncHandler(async (req, res) => {
  const {errors, value} = validateLogin(req.body);
  if (hasErrors(errors))
    throw new HttpError(400, 'Please fix the highlighted fields.', errors);
  const user = await authService.authenticate(value, 'customer');
  await noteLogin(req, user);
  const carried = await bringGuestCart(req, res, user);
  await sendSignedIn(
    req,
    res,
    user,
    200,
    `Welcome back, ${user.name.split(' ')[0]}!${carried}`,
  );
});

// POST /api/admin/login
const adminLogin = asyncHandler(async (req, res) => {
  const {errors, value} = validateLogin(req.body);
  if (hasErrors(errors))
    throw new HttpError(400, 'Please fix the highlighted fields.', errors);
  const user = await authService.authenticate(value, 'admin', {touch: false});
  // Two-step sign-in on: the password is not enough. The second step gets the code (adminLoginTwoFactor).
  if (user.twoFactor && user.twoFactor.enabled) {
    return res.json({
      message: 'Enter the 6-digit code from your authenticator app.',
      twoFactorRequired: true,
      pendingToken: adminTwoFactor.issueChallenge(user._id),
    });
  }
  await authService.touchLogin(user);
  await noteLogin(req, user);
  await adminDeviceAlert(user, req);
  return sendSignedIn(req, res, user, 200, 'Signed in to the admin console.');
});

// Email when an admin signs in from a browser they have not used before. The first browser is recorded quietly.
async function adminDeviceAlert(user, req) {
  try {
    const device = crypto
      .createHash('sha256')
      .update(String(req.get('user-agent') || 'unknown'))
      .digest('hex')
      .slice(0, 16);
    const full = await User.findById(user._id)
      .select('+adminDevices email name')
      .exec();
    if (!full) return;
    const known = full.adminDevices || [];
    if (known.includes(device)) return;
    full.adminDevices = [device, ...known].slice(0, 20);
    await full.save();
    if (!known.length) return;
    const base = siteUrl();
    const when =
      new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
    const {html, text} = renderEmail({
      preheader: 'A new browser signed in to the admin console.',
      heading: 'New sign-in to the admin console',
      paragraphs: [
        `The admin console was opened from a browser we have not seen before, at ${when}.`,
        'If this was you, nothing else is needed. If it was not, sign in and change your password now, and turn on two-step sign-in.',
      ],
      button: {label: 'Open the admin console', url: `${base}/admin`},
    });
    await mailService.send({
      to: full.email,
      subject: 'New sign-in to the admin console',
      html,
      text,
    });
  } catch {
    // An alert that cannot be sent never stops the sign-in itself.
  }
}

// POST /api/admin/login/2fa   body: { pendingToken, code }  (the second step after the password)
const adminLoginTwoFactor = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const id = adminTwoFactor.readChallenge(body.pendingToken);
  if (!id) throw new HttpError(401, 'That sign-in has expired. Start again.');
  const user = await User.findOne({_id: id, role: 'admin'}).exec();
  if (!user || user.isBlocked)
    throw new HttpError(401, 'That sign-in has expired. Start again.');
  if (!(await adminTwoFactor.verifyLogin(user, body.code)))
    throw new HttpError(
      400,
      'That code is not right. Try again, or use a recovery code.',
      {code: 'That code is not right.'},
    );
  await authService.touchLogin(user);
  await noteLogin(req, user);
  await adminDeviceAlert(user, req);
  return sendSignedIn(req, res, user, 200, 'Signed in to the admin console.');
});

// POST /api/auth/refresh   body (optional): { scope: "admin" } or { refreshToken } for API tools
//
// The renewal endpoint. It needs no access token: the refresh token itself is the proof. Every call
// ROTATES — the token sent in is revoked and a new one takes its place — so one token works once.
// Sending an old token back means someone has a copy of it, and the whole family is revoked.
const refresh = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const scope = scopeFrom(body);
  // The browser sends it in the cookie; Postman and mobile apps can send it in the body instead.
  const fromBody =
    typeof body.refreshToken === 'string' && body.refreshToken
      ? body.refreshToken
      : '';
  const rawToken = fromBody || readRefreshCookie(req, scope);

  const result = await refreshTokenService.rotate(rawToken, {
    role: scope,
    ...refreshTokenService.deviceFrom(req),
  });
  if (!result.ok) {
    // Whatever went wrong, this browser is no longer signed in: wipe all three cookies.
    endSession(res, scope);
    const message =
      result.reason === 'reuse'
        ? 'For your safety we signed you out everywhere. Please sign in again.'
        : 'Your session has ended. Please sign in again.';
    throw new HttpError(401, message);
  }

  // Another tab renewed this same token a moment ago (see the grace window in refreshTokenService).
  // This browser already holds that renewal's new refresh cookie, so it must not be touched here:
  // only a fresh access token is issued.
  if (result.concurrent) {
    const token = signToken(result.user);
    setAuthCookie(res, token, scope);
    return res.json({
      message: 'Session already renewed.',
      user: toPublicUser(result.user),
      token,
      concurrent: true,
    });
  }

  const token = startSession(res, {
    user: result.user,
    refreshToken: result.rawToken,
    familyId: result.familyId,
  });
  res.json({
    message: 'Session renewed.',
    user: toPublicUser(result.user),
    token,
    // Only handed back to a caller that sent the token in the body; a browser reads its cookie.
    refreshToken: fromBody ? result.rawToken : undefined,
  });
});

// GET /api/me
function me(req, res) {
  res.json({user: toPublicUser(req.user)});
}

// Signing out has two halves. The access token is stateless, so it is enough to delete its cookie.
// The refresh token is a database row, so it has to be revoked or it could renew the session again.
//
// The refresh cookie's path is the renewal endpoint, so the browser does NOT send it here. What it
// does send is the session label (nx_sid), which names the family, and revoking the family revokes
// the refresh token inside it. API tools without cookies can send { refreshToken } in the body.
async function signOut(req, res, kind) {
  const rawToken =
    readRefreshCookie(req, kind) ||
    (req.body && typeof req.body.refreshToken === 'string'
      ? req.body.refreshToken
      : '');
  if (rawToken) await refreshTokenService.revokeToken(rawToken, 'logout');
  await refreshTokenService.revokeFamily(
    readSessionCookie(req, kind),
    'logout',
    req.user ? req.user._id : null,
  );
  endSession(res, kind);
}

// POST /api/logout
const logout = asyncHandler(async (req, res) => {
  await signOut(req, res, 'customer');
  res.json({message: 'You have been signed out.'});
});

// POST /api/admin/logout (only the admin session ends; a customer session in the same browser stays)
const adminLogout = asyncHandler(async (req, res) => {
  await signOut(req, res, 'admin');
  // Tell the browser to drop every stored copy of this site's pages, so no admin screen can come
  // back from its cache or the Back/Forward memory. Cookies and storage are left alone, so a
  // customer signed in to the store in the same browser stays signed in.
  res.set('Clear-Site-Data', '"cache"');
  res.json({message: 'You have been signed out of the admin console.'});
});

module.exports = {
  noteLogin,
  bringGuestCart,
  sendSignedIn,
  signup,
  login,
  adminLogin,
  adminLoginTwoFactor,
  refresh,
  me,
  logout,
  adminLogout,
};
