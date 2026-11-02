const { COOKIE_NAME } = require("../services/tokenService");
const { HttpError } = require("../utils/http");

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// CSRF protection. Browsers attach the login cookie to every request, even one started by
// another website. So any request that changes data must come from this site's own pages.
function originCheck(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();

  // Bearer tokens are never sent automatically by a browser, so they cannot be used for CSRF.
  if ((req.get("authorization") || "").startsWith("Bearer ")) return next();

  const source = req.get("origin") || req.get("referer");
  if (!source) {
    const hasLoginCookie = Boolean(req.cookies && req.cookies[COOKIE_NAME]);
    return hasLoginCookie
      ? next(new HttpError(403, "Request blocked because its origin is unknown."))
      : next();
  }

  let sourceHost = null;
  try {
    sourceHost = new URL(source).host;
  } catch {
    sourceHost = null;
  }
  if (sourceHost && sourceHost === req.get("host")) return next();
  return next(new HttpError(403, "Request blocked because it did not come from this website."));
}

module.exports = { originCheck };
