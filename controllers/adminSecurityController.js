// Account security for the signed-in admin: turn two-step sign-in on or off (services/adminTwoFactorService.js).
const adminTwoFactor = require('../services/adminTwoFactorService');
const auditService = require('../services/auditService');
const User = require('../models/User');
const {asyncHandler} = require('../utils/http');

// POST /api/admin/security/2fa/setup
const setup = asyncHandler(async (req, res) => {
  res.json(await adminTwoFactor.beginSetup(req.user._id));
});

// POST /api/admin/security/2fa/enable   body: { code }
const enable = asyncHandler(async (req, res) => {
  const result = await adminTwoFactor.enable(
    req.user._id,
    (req.body || {}).code,
  );
  await auditService.record({
    ...auditService.fromRequest(req),
    action: 'admin.2fa_on',
    target: `user:${req.user._id}`,
  });
  res.json({
    message:
      'Two-step sign-in is on. Keep these recovery codes somewhere safe. Each works once.',
    recoveryCodes: result.recoveryCodes,
  });
});

// POST /api/admin/security/2fa/disable   body: { code }
const disable = asyncHandler(async (req, res) => {
  const result = await adminTwoFactor.disable(
    req.user._id,
    (req.body || {}).code,
  );
  await auditService.record({
    ...auditService.fromRequest(req),
    action: 'admin.2fa_off',
    target: `user:${req.user._id}`,
  });
  res.json(result);
});

// GET <ADMIN_PATH>/security
const page = asyncHandler(async (req, res) => {
  const me = await User.findById(req.user._id)
    .select('twoFactor.enabled')
    .lean();
  res.render('admin/security', {
    title: 'Account security | Nexthlon Admin',
    section: 'security',
    twoFactorOn: Boolean(me && me.twoFactor && me.twoFactor.enabled),
  });
});

module.exports = {setup, enable, disable, page};
