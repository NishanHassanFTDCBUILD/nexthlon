// Sign in or sign up with a code sent to your phone (see services/phoneSignInService.js).
const phoneSignIn = require('../services/phoneSignInService');
const emailVerificationService = require('../services/emailVerificationService');
const authService = require('../services/authService');
const {asyncHandler, HttpError} = require('../utils/http');
const {validateSignup} = require('../utils/validators');
const {siteUrlFor} = require('../utils/emailLayout');
const {noteLogin, bringGuestCart, sendSignedIn} = require('./authController');

// POST /api/auth/phone/request   body: { phone }
const requestCode = asyncHandler(async (req, res) => {
  res.json(await phoneSignIn.requestCode((req.body || {}).phone));
});

// POST /api/auth/phone/verify   body: { phone, code }
// A number with an account is signed in. A new number gets { needsProfile, ticket } and the page asks
// for a name and email next (POST /api/auth/phone/signup).
const verifyCode = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const {user, ticket} = await phoneSignIn.verifyCode(body.phone, body.code);
  if (!user)
    return res.json({
      needsProfile: true,
      ticket,
      message: 'Number confirmed. Add your name and email to finish.',
    });
  await authService.touchLogin(user);
  await noteLogin(req, user);
  const carried = await bringGuestCart(req, res, user);
  return sendSignedIn(
    req,
    res,
    user,
    200,
    `Welcome back, ${user.name.split(' ')[0]}!${carried}`,
  );
});

// POST /api/auth/phone/signup   body: { ticket, name, email, referralCode? }
const createAccount = asyncHandler(async (req, res) => {
  const body = req.body || {};
  // The signup checks without a password: a phone account has none until "Forgot password".
  const {errors, value} = validateSignup({...body, password: 'Phone1234'});
  delete errors.password;
  delete errors.confirmPassword;
  if (Object.keys(errors).length)
    throw new HttpError(400, 'Please fix the highlighted fields.', errors);
  const user = await phoneSignIn.createAccount(body.ticket, value);
  await noteLogin(req, user);
  emailVerificationService.sendInBackground(user, {
    baseUrl: siteUrlFor(req),
    ip: req.ip,
  });
  const carried = await bringGuestCart(req, res, user);
  return sendSignedIn(
    req,
    res,
    user,
    201,
    `Welcome to Nexthlon! Your account is ready.${carried}`,
  );
});

module.exports = {requestCode, verifyCode, createAccount};
