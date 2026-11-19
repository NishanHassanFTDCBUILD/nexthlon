// Sign in with a code sent to your phone (see services/phoneSignInService.js).
const phoneSignIn = require('../services/phoneSignInService');
const {asyncHandler} = require('../utils/http');
const {toPublicUser} = require('../utils/publicUser');
const {startSession} = require('../services/tokenService');
const refreshTokenService = require('../services/refreshTokenService');
const authService = require('../services/authService');

// POST /api/auth/phone/request   body: { phone }
const requestCode = asyncHandler(async (req, res) => {
  res.json(await phoneSignIn.requestCode((req.body || {}).phone));
});

// POST /api/auth/phone/verify   body: { phone, code }
const verifyCode = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const user = await phoneSignIn.verifyCode(body.phone, body.code);
  await authService.touchLogin(user);
  const {rawToken, familyId} = await refreshTokenService.issue(
    user,
    refreshTokenService.deviceFrom(req),
  );
  const token = startSession(res, {user, refreshToken: rawToken, familyId});
  res.json({
    message: `Welcome back, ${user.name.split(' ')[0]}!`,
    user: toPublicUser(user),
    token,
  });
});

module.exports = {requestCode, verifyCode};
