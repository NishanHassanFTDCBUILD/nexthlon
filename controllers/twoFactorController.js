// Two-step login for admins: the API behind the console's Security page. All of it needs a signed-in
// admin (routes/adminRoutes.js). The rules live in services/twoFactorService.js.
const twoFactorService = require("../services/twoFactorService");
const authMailService = require("../services/authMailService");
const config = require("../config/env");
const { validateTwoFactorCode, validatePasswordAndCode, hasErrors } = require("../utils/validators");
const { HttpError, asyncHandler } = require("../utils/http");
const { background } = require("../utils/background");

// A wrong password or code here is a problem with the form, not a signed-out session. The service says 401
// (right for the sign-in step), but the browser code treats a 401 from a signed-in page as "your session
// ended" and sends the admin to the sign-in page. So these answer 400, like every other form in the console.
async function asFormError(work) {
  try {
    return await work();
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) throw new HttpError(400, error.message, error.fieldErrors);
    throw error;
  }
}

function checked(validate, body) {
  const { errors, value } = validate(body);
  if (hasErrors(errors)) throw new HttpError(400, "Please fix the highlighted fields.", errors);
  return value;
}

// GET /api/admin/2fa
const status = asyncHandler(async (req, res) => {
  res.json({ ...(await twoFactorService.status(req.user._id)), required: config.adminRequire2fa });
});

// POST /api/admin/2fa/setup
// A new secret, as a QR code to scan and as text to type in. Nothing is on until the first code is confirmed.
const setup = asyncHandler(async (req, res) => {
  const { secret, uri, qrSvg } = await twoFactorService.startSetup(req.user._id);
  // An image address rather than markup, so the page never has to insert HTML.
  res.json({ secret, uri, qr: `data:image/svg+xml;base64,${Buffer.from(qrSvg).toString("base64")}` });
});

// POST /api/admin/2fa/enable   { code }
// The recovery codes in the reply are shown once; only their hashes are kept.
const enable = asyncHandler(async (req, res) => {
  const { code } = checked(validateTwoFactorCode, req.body);
  const { recoveryCodes } = await asFormError(() => twoFactorService.confirmSetup(req.user._id, code));
  background("two_factor.notice", () => authMailService.sendTwoFactorChanged(req.user, true));
  res.json({ message: "Two-step login is on. Save your recovery codes now: they are shown only once.", recoveryCodes });
});

// POST /api/admin/2fa/disable   { password, code }
const disable = asyncHandler(async (req, res) => {
  await asFormError(() => twoFactorService.disable(req.user._id, checked(validatePasswordAndCode, req.body)));
  background("two_factor.notice", () => authMailService.sendTwoFactorChanged(req.user, false));
  res.json({ message: "Two-step login is off." });
});

// POST /api/admin/2fa/recovery-codes   { password, code }
const regenerate = asyncHandler(async (req, res) => {
  const { recoveryCodes } = await asFormError(() => twoFactorService.regenerateRecoveryCodes(req.user._id, checked(validatePasswordAndCode, req.body)));
  res.json({ message: "New recovery codes made. The old ones no longer work.", recoveryCodes });
});

module.exports = { status, setup, enable, disable, regenerate };
