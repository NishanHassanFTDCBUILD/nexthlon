const crypto = require("crypto");
const config = require("../config/env");
const { HttpError } = require("../utils/http");

// The guest cart cookie: a random token in an httpOnly cookie. The server keeps only its SHA-256 hash
// (models/GuestCart.js). It is made the first time a guest adds something, never just for browsing.
const COOKIE = "nx_cart";
// A readable twin that only says "this browser has a guest cart" (no token in it), so the page can fetch
// the badge count after it loads (store.js) while the page itself stays the same for every guest.
const HINT_COOKIE = "nx_has_cart";
const MAX_AGE = 30 * 24 * 60 * 60 * 1000;
const TOKEN = /^[A-Za-z0-9_-]{43}$/; // 32 random bytes, base64url

const hashOf = token => crypto.createHash("sha256").update(token).digest("hex");
const cookieOptions = () => ({ httpOnly: true, sameSite: "lax", secure: config.cookieSecure, path: "/" });

// The hash of this browser's guest cart token, or null when it has none (or a malformed one).
function readGuestCart(req) {
  const token = req.cookies && req.cookies[COOKIE];
  return typeof token === "string" && TOKEN.test(token) ? hashOf(token) : null;
}

// The hash of this browser's guest cart token, making the token (and the cookie) first when needed.
function ensureGuestCart(req, res) {
  const existing = readGuestCart(req);
  if (existing) return existing;
  const token = crypto.randomBytes(32).toString("base64url");
  res.cookie(COOKIE, token, { ...cookieOptions(), maxAge: MAX_AGE });
  res.cookie(HINT_COOKIE, "1", { ...cookieOptions(), httpOnly: false, maxAge: MAX_AGE });
  return hashOf(token);
}

function clearGuestCart(res) {
  res.clearCookie(COOKIE, cookieOptions());
  res.clearCookie(HINT_COOKIE, { ...cookieOptions(), httpOnly: false });
}

// Who owns the cart for this request, as req.cartOwner (what cartService takes):
//   a signed-in customer: their user id
//   a guest: { guest: <token hash> }, with the cookie made on the first change (GET leaves it alone)
//   a guest without a cart yet, on a GET: null (an empty cart)
// A login that has run out answers 401 first, so the browser renews it and the account's own cart is
// used, never a guest cart by mistake. A blocked account gets 403, as everywhere else.
function cartOwner(req, res, next) {
  if (req.user) {
    if (req.user.role !== "customer") return next(new HttpError(403, "You do not have permission to do this."));
    req.cartOwner = req.user._id;
    return next();
  }
  if (req.authProblem === "blocked") return next(new HttpError(403, "Your account has been blocked. Please contact Nexthlon support."));
  if (req.authProblem === "expired") return next(new HttpError(401, "Please sign in to continue."));
  const hash = req.method === "GET" ? readGuestCart(req) : ensureGuestCart(req, res);
  // A cart made before the readable hint existed: add the hint now, or its badge would stay empty.
  if (hash && !(req.cookies && req.cookies[HINT_COOKIE])) {
    res.cookie(HINT_COOKIE, "1", { ...cookieOptions(), httpOnly: false, maxAge: MAX_AGE });
  }
  req.cartOwner = hash ? { guest: hash } : null;
  return next();
}

module.exports = { COOKIE, HINT_COOKIE, readGuestCart, ensureGuestCart, clearGuestCart, cartOwner, hashOf };
