const jwt = require("jsonwebtoken");
const config = require("../config/env");

const ISSUER = "nexthlon";

// Customers and admins have separate sessions: their own cookie, their own JWT audience and
// their own lifetime. A customer token can never open the admin console, and an admin token is
// never read by the store. The admin cookie is SameSite=Strict, so other sites can't send it.
const KINDS = {
  customer: { cookie: "nx_token", audience: "nexthlon-web", expiresIn: config.jwtExpiresIn, maxAge: config.jwtExpiresInMs, sameSite: "lax" },
  admin: { cookie: "nx_admin", audience: "nexthlon-admin", expiresIn: config.adminJwtExpiresIn, maxAge: config.adminJwtExpiresInMs, sameSite: "strict" }
};
const COOKIE_NAME = KINDS.customer.cookie;
const ADMIN_COOKIE_NAME = KINDS.admin.cookie;

const kindOf = user => (user.role === "admin" ? "admin" : "customer");

// The token holds only the user id, role and token version. Nothing secret goes inside a JWT,
// because anyone can read its contents. The signature only stops it from being changed.
function signToken(user) {
  const kind = KINDS[kindOf(user)];
  return jwt.sign({ role: user.role, ver: user.tokenVersion || 0 }, config.jwtSecret, {
    subject: String(user._id),
    expiresIn: kind.expiresIn,
    issuer: ISSUER,
    audience: kind.audience,
    algorithm: "HS256"
  });
}

// Throws if the token is fake, changed, expired or made for the other kind of session.
function verifyToken(token, kind = "customer") {
  return jwt.verify(token, config.jwtSecret, {
    algorithms: ["HS256"],
    issuer: ISSUER,
    audience: KINDS[kind].audience
  });
}

function cookieOptions(kind) {
  return { httpOnly: true, sameSite: KINDS[kind].sameSite, secure: config.cookieSecure, path: "/" };
}

// httpOnly means browser JavaScript cannot read the token, which protects it from XSS.
function setAuthCookie(res, token, kind = "customer") {
  res.cookie(KINDS[kind].cookie, token, { ...cookieOptions(kind), maxAge: KINDS[kind].maxAge });
}

function clearAuthCookie(res, kind = "customer") {
  res.clearCookie(KINDS[kind].cookie, cookieOptions(kind));
}

module.exports = { COOKIE_NAME, ADMIN_COOKIE_NAME, KINDS, kindOf, signToken, verifyToken, setAuthCookie, clearAuthCookie };
