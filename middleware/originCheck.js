const {KINDS} = require('../services/tokenService');
const {HttpError} = require('../utils/http');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Every cookie that proves a login: the access and refresh cookies of the store AND the admin console.
const SESSION_COOKIES = Object.values(KINDS).flatMap((kind) => [
  kind.cookie,
  kind.refreshCookie,
]);

// CSRF protection. Browsers attach the login cookie to every request, even one started by
// another website. So any request that changes data must come from this site's own pages.
function originCheck(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();

  // Bearer tokens are never sent automatically by a browser, so they cannot be used for CSRF.
  if ((req.get('authorization') || '').startsWith('Bearer ')) return next();

  const source = req.get('origin') || req.get('referer');
  if (!source) {
    // No Origin and no Referer: only a client without a login cookie (an API tool, a script) may go on.
    // The check used to look at the customer cookie only, so a request carrying just the admin cookie
    // slipped through.
    const hasLoginCookie = SESSION_COOKIES.some((name) =>
      Boolean(req.cookies && req.cookies[name]),
    );
    return hasLoginCookie
      ? next(
          new HttpError(403, 'Request blocked because its origin is unknown.'),
        )
      : next();
  }

  let sourceHost;
  try {
    sourceHost = new URL(source).host;
  } catch {
    sourceHost = null;
  }
  if (sourceHost && sourceHost === req.get('host')) return next();
  return next(
    new HttpError(
      403,
      'Request blocked because it did not come from this website.',
    ),
  );
}

module.exports = {originCheck};
