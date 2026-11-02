const User = require("../models/User");
const { COOKIE_NAME, verifyToken, clearAuthCookie } = require("../services/tokenService");
const { HttpError } = require("../utils/http");

// The token can arrive as a "Bearer" header (Postman, mobile apps) or as the login cookie (browser).
function readToken(req) {
  const header = req.get("authorization") || "";
  if (header.startsWith("Bearer ")) return { token: header.slice(7).trim(), fromCookie: false };
  const cookie = req.cookies && req.cookies[COOKIE_NAME];
  return cookie ? { token: cookie, fromCookie: true } : { token: null, fromCookie: false };
}

// Runs on every request. The JWT says who the user is. The quick database lookup makes sure
// the account still exists, is not blocked, and has not changed its password since the token was made.
// No sessions are stored on the server: the token itself is the proof of login.
async function attachUser(req, res, next) {
  req.user = null;
  req.authProblem = null;
  const { token, fromCookie } = readToken(req);
  if (!token) return next();

  try {
    let payload = null;
    try {
      payload = verifyToken(token);
    } catch {
      payload = null;
    }
    const user = payload ? await User.findById(payload.sub) : null;

    if (!user || user.role !== payload.role) {
      req.authProblem = "expired";
    } else if ((payload.ver || 0) !== (user.tokenVersion || 0)) {
      req.authProblem = "expired";
    } else if (user.isBlocked) {
      req.authProblem = "blocked";
    } else {
      req.user = user;
      res.locals.currentUser = user.toSafeJSON();
    }

    if (req.authProblem && fromCookie) clearAuthCookie(res);
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

// ---------- Page guards: they redirect instead ----------

function redirectToLogin(req, res, loginPath) {
  const params = new URLSearchParams({ next: req.originalUrl });
  if (req.authProblem) params.set("reason", req.authProblem);
  return res.redirect(`${loginPath}?${params}`);
}

function customerPage(req, res, next) {
  if (!req.user) return redirectToLogin(req, res, "/login");
  if (req.user.role !== "customer") return res.redirect("/admin");
  return next();
}

function adminPage(req, res, next) {
  if (!req.user) return redirectToLogin(req, res, "/admin/login");
  if (req.user.role !== "admin") {
    return next(new HttpError(403, "This area is only for Nexthlon administrators."));
  }
  return next();
}

// Signed-in users have no reason to see the login and signup pages.
function guestOnly(req, res, next) {
  if (!req.user) return next();
  return res.redirect(req.user.role === "admin" ? "/admin" : "/");
}

module.exports = { attachUser, requireAuth, requireRole, customerPage, adminPage, guestOnly };
