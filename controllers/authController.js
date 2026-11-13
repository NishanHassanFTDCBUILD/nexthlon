const authService = require("../services/authService");
const refreshTokenService = require("../services/refreshTokenService");
const { startSession, endSession, readRefreshCookie, readSessionCookie, signToken, setAuthCookie, signTwoFactorChallenge, verifyTwoFactorChallenge } = require("../services/tokenService");
const twoFactorService = require("../services/twoFactorService");
const emailVerificationService = require("../services/emailVerificationService");
const { siteUrlFor } = require("../utils/emailLayout");
const { validateSignup, validateLogin, validateTwoFactorLogin, hasErrors } = require("../utils/validators");
const { HttpError, asyncHandler } = require("../utils/http");
const { formatPaise } = require("../utils/money");
const accountService = require("../services/accountService");
const logger = require("../utils/logger");
const { toPublicUser } = require("../utils/publicUser");
const cartService = require("../services/cartService");
const { readGuestCart, clearGuestCart } = require("../middleware/guestCart");

// Adds the sign-in to the account's login activity (browser and masked IP). Never blocks signing in.
async function noteLogin(req, user) {
  try {
    await accountService.recordLogin(user._id, { userAgent: req.get("user-agent"), ip: req.ip });
  } catch (error) {
    logger.warn("login_activity.failed", { error });
  }
}

// What a guest put in their cart before signing in moves into the account's cart, and the guest cart
// cookie goes. Never blocks signing in: if it fails, the guest cart simply stays for next time.
// Returns a sentence for the welcome message ("" when nothing moved).
async function bringGuestCart(req, res, user) {
  const guest = readGuestCart(req);
  if (!guest) return "";
  try {
    const { moved } = await cartService.mergeGuestCart(user._id, guest);
    clearGuestCart(res);
    return moved ? ` The ${moved === 1 ? "item" : "items"} in your cart ${moved === 1 ? "is" : "are"} saved to your account.` : "";
  } catch (error) {
    logger.warn("guest_cart.merge_failed", { error });
    return "";
  }
}

// Which session a refresh request is for. The browser says "admin" only from the admin console;
// everything else is the store. Each kind has its own refresh cookie, so both can be signed in
// in one browser without clashing.
function scopeFrom(body) {
  return body && body.scope === "admin" ? "admin" : "customer";
}

// Issues a brand new pair: a short-lived access token (JWT) and a long-lived refresh token, each in
// its own httpOnly cookie. The access token is also returned in the body for API tools like Postman.
async function sendSignedIn(req, res, user, status, message) {
  const { rawToken, familyId } = await refreshTokenService.issue(user, refreshTokenService.deviceFrom(req));
  const token = startSession(res, { user, refreshToken: rawToken, familyId });
  res.status(status).json({ message, user: toPublicUser(user), token });
}

// POST /api/signup
const signup = asyncHandler(async (req, res) => {
  const { errors, value } = validateSignup(req.body);
  if (hasErrors(errors)) throw new HttpError(400, "Please fix the highlighted fields.", errors);
  const user = await authService.registerCustomer(value);
  await noteLogin(req, user);
  // Ask them to confirm the address. In the background: they are signing up, not waiting for an email server.
  emailVerificationService.sendInBackground(user, { baseUrl: siteUrlFor(req), ip: req.ip });
  const bonus = user.referralReward ? ` ${formatPaise(user.referralReward)} has been added to your wallet.` : "";
  const carried = await bringGuestCart(req, res, user);
  await sendSignedIn(req, res, user, 201, `Welcome to Nexthlon! Your account is ready.${bonus}${carried}`);
});

// POST /api/login
const login = asyncHandler(async (req, res) => {
  const { errors, value } = validateLogin(req.body);
  if (hasErrors(errors)) throw new HttpError(400, "Please fix the highlighted fields.", errors);
  const user = await authService.authenticate(value, "customer");
  await noteLogin(req, user);
  const carried = await bringGuestCart(req, res, user);
  await sendSignedIn(req, res, user, 200, `Welcome back, ${user.name.split(" ")[0]}!${carried}`);
});

// POST /api/admin/login
const adminLogin = asyncHandler(async (req, res) => {
  const { errors, value } = validateLogin(req.body);
  if (hasErrors(errors)) throw new HttpError(400, "Please fix the highlighted fields.", errors);
  // The password only. With two-step login on, the admin is not signed in yet: they get a 5-minute pass
  // to send back with a code (POST /api/admin/login/2fa).
  const user = await authService.authenticate(value, "admin", { touch: false });
  if (user.twoFactor && user.twoFactor.enabled) {
    return res.json({ twoFactorRequired: true, challenge: signTwoFactorChallenge(user), message: "Enter the 6-digit code from your authenticator app." });
  }
  await authService.touchLogin(user);
  await noteLogin(req, user);
  return sendSignedIn(req, res, user, 200, "Signed in to the admin console.");
});

// POST /api/admin/login/2fa   { challenge, code }
// The second half. The code is a 6-digit code from the app, or one of the recovery codes.
const adminLoginTwoFactor = asyncHandler(async (req, res) => {
  const { errors, value } = validateTwoFactorLogin(req.body);
  if (errors.form) throw new HttpError(401, errors.form);
  if (hasErrors(errors)) throw new HttpError(400, "Please fix the highlighted fields.", errors);

  let user = null;
  try {
    user = await authService.adminForChallenge(verifyTwoFactorChallenge(value.challenge));
  } catch {
    user = null;
  }
  if (!user) throw new HttpError(401, "Your sign-in timed out. Enter your email and password again.");

  const result = await twoFactorService.verifyLogin(user._id, value.code);
  await authService.touchLogin(user);
  await noteLogin(req, user);
  const note = result.method === "recovery" ? ` You used a recovery code; ${result.recoveryLeft} left. Make new ones under Security.` : "";
  await sendSignedIn(req, res, user, 200, `Signed in to the admin console.${note}`);
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
  const fromBody = typeof body.refreshToken === "string" && body.refreshToken ? body.refreshToken : "";
  const rawToken = fromBody || readRefreshCookie(req, scope);

  const result = await refreshTokenService.rotate(rawToken, { role: scope, ...refreshTokenService.deviceFrom(req) });
  if (!result.ok) {
    // Whatever went wrong, this browser is no longer signed in: wipe all three cookies.
    endSession(res, scope);
    const message = result.reason === "reuse"
      ? "For your safety we signed you out everywhere. Please sign in again."
      : "Your session has ended. Please sign in again.";
    throw new HttpError(401, message);
  }

  // Another tab renewed this same token a moment ago (see the grace window in refreshTokenService).
  // This browser already holds that renewal's new refresh cookie, so it must not be touched here:
  // only a fresh access token is issued.
  if (result.concurrent) {
    const token = signToken(result.user);
    setAuthCookie(res, token, scope);
    return res.json({ message: "Session already renewed.", user: toPublicUser(result.user), token, concurrent: true });
  }

  const token = startSession(res, { user: result.user, refreshToken: result.rawToken, familyId: result.familyId });
  res.json({
    message: "Session renewed.",
    user: toPublicUser(result.user),
    token,
    // Only handed back to a caller that sent the token in the body; a browser reads its cookie.
    refreshToken: fromBody ? result.rawToken : undefined
  });
});

// GET /api/me
function me(req, res) {
  res.json({ user: toPublicUser(req.user) });
}

// Signing out has two halves. The access token is stateless, so it is enough to delete its cookie.
// The refresh token is a database row, so it has to be revoked or it could renew the session again.
//
// The refresh cookie's path is the renewal endpoint, so the browser does NOT send it here. What it
// does send is the session label (nx_sid), which names the family, and revoking the family revokes
// the refresh token inside it. API tools without cookies can send { refreshToken } in the body.
async function signOut(req, res, kind) {
  const rawToken = readRefreshCookie(req, kind) || (req.body && typeof req.body.refreshToken === "string" ? req.body.refreshToken : "");
  if (rawToken) await refreshTokenService.revokeToken(rawToken, "logout");
  await refreshTokenService.revokeFamily(readSessionCookie(req, kind), "logout", req.user ? req.user._id : null);
  endSession(res, kind);
}

// POST /api/logout
const logout = asyncHandler(async (req, res) => {
  await signOut(req, res, "customer");
  res.json({ message: "You have been signed out." });
});

// POST /api/admin/logout (only the admin session ends; a customer session in the same browser stays)
const adminLogout = asyncHandler(async (req, res) => {
  await signOut(req, res, "admin");
  res.json({ message: "You have been signed out of the admin console." });
});

module.exports = { signup, login, adminLogin, adminLoginTwoFactor, refresh, me, logout, adminLogout };
