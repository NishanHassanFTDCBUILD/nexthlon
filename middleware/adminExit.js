// Leaving the admin console for the store ends the admin session, however the admin leaves: the
// "View store" link, the browser's Back button, a typed address or a bookmark. Any store page that
// arrives with admin cookies signs the admin out before it is shown, so Back or Forward into the
// console afterwards finds no session (and gets the plain 404 the console gives to strangers).
//
// Only the admin session ends. A customer signed in to the store in the same browser stays signed in.
// Mounted just before the store pages (app.js), so admin pages, /api calls and files never reach it.
const refreshTokenService = require('../services/refreshTokenService');
const {
  endSession,
  readSessionCookie,
  ADMIN_COOKIE_NAME,
} = require('../services/tokenService');
const config = require('../config/env');
const logger = require('../utils/logger');

async function endAdminOnStore(req, res, next) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  // An unknown address under the console's own path falls through to here: that is not leaving.
  // Nor is an /api address that matches no route (an admin tab still running last deploy's script
  // can ask for one): it gets its 404, and the admin stays signed in.
  const path = req.path;
  if (
    path === config.adminPath ||
    path.startsWith(`${config.adminPath}/`) ||
    path === '/api' ||
    path.startsWith('/api/')
  )
    return next();
  // A browser prefetching or prerendering a store link is not the admin leaving either.
  const purpose = String(
    req.get('sec-purpose') || req.get('purpose') || '',
  ).toLowerCase();
  if (purpose.includes('prefetch') || purpose.includes('prerender'))
    return next();
  const familyId = readSessionCookie(req, 'admin');
  const hasAccess = Boolean(req.cookies && req.cookies[ADMIN_COOKIE_NAME]);
  if (!familyId && !hasAccess) return next();
  try {
    // The refresh cookie is only ever sent to /api/auth/refresh, so it is not here; revoking the
    // whole sign-in (its family) stops it renewing anyway.
    if (familyId)
      await refreshTokenService.revokeFamily(familyId, 'left_admin');
  } catch (error) {
    logger.warn('admin_exit.revoke_failed', {error});
  }
  endSession(res, 'admin');
  return next();
}

module.exports = {endAdminOnStore};
