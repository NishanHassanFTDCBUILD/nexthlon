// ADMIN_REQUIRE_2FA=true: an admin who has not turned on two-step login can sign in, but can use nothing
// but the Security page until they do. (Without the setting two-step login is optional.)
// Mounted after the Security page and its API, so those stay reachable.
const config = require("../config/env");
const { HttpError } = require("../utils/http");

function requireTwoFactorSetup(req, res, next) {
  if (!config.adminRequire2fa || !req.user || req.user.role !== "admin" || req.user.twoFactor.enabled) return next();
  if (req.originalUrl.startsWith("/api/")) {
    return next(new HttpError(403, "Two-step login is required for the admin console. Turn it on under Security first."));
  }
  return res.redirect(`${config.adminPath}/security?reason=required`);
}

module.exports = { requireTwoFactorSetup };
