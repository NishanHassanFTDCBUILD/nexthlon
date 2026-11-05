const User = require("../models/User");
const config = require("../config/env");
const { KINDS, verifyToken, clearAuthCookie, readSessionCookie } = require("../services/tokenService");
const { HttpError } = require("../utils/http");

// Which session a request belongs to: the admin console (its pages under ADMIN_PATH and the
// /api/admin APIs) or the store (everything else). Each reads only its own cookie.
function scopeOf(req) {
  const path = req.path.toLowerCase();
  const admin = config.adminPath;
  if (path === admin || path.startsWith(`${admin}/`) || path === "/api/admin" || path.startsWith("/api/admin/")) return "admin";
  return "customer";
}

// The token can arrive as a "Bearer" header (Postman, mobile apps) or as the session cookie (browser).
function readToken(req, scope) {
  const header = req.get("authorization") || "";
  if (header.startsWith("Bearer ")) return { token: header.slice(7).trim(), fromCookie: false };
  const cookie = req.cookies && req.cookies[KINDS[scope].cookie];
  return cookie ? { token: cookie, fromCookie: true } : { token: null, fromCookie: false };
}

// Runs on every request. The JWT says who the user is. The quick database lookup makes sure
// the account still exists, is not blocked, and has not changed its password since the token was made.
// No sessions are stored on the server: the token itself is the proof of login.
// In the store req.user is always a customer; in the admin console it is always an admin.
async function attachUser(req, res, next) {
  req.user = null;
  req.authProblem = null;
  const scope = scopeOf(req);
  req.authScope = scope;
  const { token, fromCookie } = readToken(req, scope);
  if (!token) return next();

  try {
    let payload = null;
    try {
      payload = verifyToken(token, scope);
    } catch {
      payload = null;
    }
    const role = scope === "admin" ? "admin" : "customer";
    const user = payload && payload.role === role ? await User.findById(payload.sub) : null;

    if (!user || user.role !== role || user.isDeleted) {
      req.authProblem = "expired";
    } else if ((payload.ver || 0) !== (user.tokenVersion || 0)) {
      req.authProblem = "expired";
    } else if (user.isBlocked) {
      req.authProblem = "blocked";
    } else {
      req.user = user;
      res.locals.currentUser = user.toSafeJSON();
    }

    // Only the ACCESS cookie goes. The refresh cookie is deliberately left alone: an access token
    // that has run out is the normal case, and the refresh token is what renews it
    // (POST /api/auth/refresh). Clearing it here would end the session every 15 minutes.
    if (req.authProblem && fromCookie) clearAuthCookie(res, scope);
    return next();
  } catch (error) {
    return next(error);
  }
}

// ---------- API guards: they reply with JSON errors ----------
function requireAuth(req, res, next) {
  if (req.user) return next();
  if (req.authProblem === "blocked") {
    return next(new HttpError(403, "Your account has been blocked. Please contact Nexthlon support."));
  }
  return next(new HttpError(401, "Please sign in to continue."));
}

function requireRole(role) {
  return function roleGuard(req, res, next) {
    if (req.user && req.user.role === role) return next();
    return next(new HttpError(403, "You do not have permission to do this."));
  };
}

// ---------- Page guards ----------

// A page load cannot renew the session by itself: the refresh cookie is only sent to
// /api/auth/refresh. So when the browser still carries the session label (nx_sid), the login page
// is told the session merely expired, and its script renews it and comes straight back
// (renewAfterBounce in public/js/app.js). A visitor with no session at all gets no reason.
function loginReason(req, kind) {
  return req.authProblem || (readSessionCookie(req, kind) ? "expired" : null);
}

function redirectToLogin(req, res, loginPath, reason) {
  const params = new URLSearchParams({ next: req.originalUrl });
  if (reason) params.set("reason", reason);
  return res.redirect(`${loginPath}?${params}`);
}

// Customer pages send signed-out visitors to sign in.
function customerPage(req, res, next) {
  if (!req.user || req.user.role !== "customer") {
    return redirectToLogin(req, res, "/login", loginReason(req, "customer"));
  }
  return next();
}

// Admin pages: anyone who is not a signed-in admin gets the ordinary "page not found", so the
// console's existence and address are never revealed. Only the exact login URL shows a form.
// The one exception is a browser that was signed in as an admin a moment ago (it still has the
// admin session label): it is sent to the admin login, which renews the session and carries on.
// Nothing is given away, because only a browser that already knew the console can get that far.
function adminPage(req, res, next) {
  if (req.user && req.user.role === "admin") return next();
  if (readSessionCookie(req, "admin")) {
    return redirectToLogin(req, res, `${config.adminPath}/login`, loginReason(req, "admin"));
  }
  return next(new HttpError(404, "We couldn't find that page."));
}

// Signed-in customers have no reason to see the store's login and signup pages.
function guestOnly(req, res, next) {
  if (!req.user) return next();
  return res.redirect("/");
}

// A signed-in admin opening the admin login goes straight to the dashboard.
function adminGuestOnly(req, res, next) {
  if (!req.user) return next();
  return res.redirect(`${config.adminPath}/dashboard`);
}

module.exports = { scopeOf, attachUser, requireAuth, requireRole, customerPage, adminPage, guestOnly, adminGuestOnly };
