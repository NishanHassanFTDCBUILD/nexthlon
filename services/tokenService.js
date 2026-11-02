const jwt = require("jsonwebtoken");
const config = require("../config/env");

const COOKIE_NAME = "nx_token";
const ISSUER = "nexthlon";
const AUDIENCE = "nexthlon-web";

// The token holds only the user id, role and token version. Nothing secret goes inside a JWT,
// because anyone can read its contents. The signature only stops it from being changed.
function signToken(user) {
  return jwt.sign({ role: user.role, ver: user.tokenVersion || 0 }, config.jwtSecret, {
    subject: String(user._id),
    expiresIn: config.jwtExpiresIn,
    issuer: ISSUER,
    audience: AUDIENCE,
    algorithm: "HS256"
  });
}

// Throws if the token is fake, changed, expired or made for another app.
function verifyToken(token) {
  return jwt.verify(token, config.jwtSecret, {
    algorithms: ["HS256"],
    issuer: ISSUER,
    audience: AUDIENCE
  });
}

function cookieOptions() {
  return { httpOnly: true, sameSite: "lax", secure: config.cookieSecure, path: "/" };
}

// httpOnly means browser JavaScript cannot read the token, which protects it from XSS.
function setAuthCookie(res, token) {
  res.cookie(COOKIE_NAME, token, { ...cookieOptions(), maxAge: config.jwtExpiresInMs });
}

function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME, cookieOptions());
}

module.exports = { COOKIE_NAME, signToken, verifyToken, setAuthCookie, clearAuthCookie };
