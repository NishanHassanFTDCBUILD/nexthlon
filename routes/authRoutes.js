const router = require('express').Router();
const {
  signup,
  login,
  adminLogin,
  refresh,
  me,
  logout,
  adminLogout,
} = require('../controllers/authController');
const recovery = require('../controllers/recoveryController');
const {requireAuth} = require('../middleware/auth');
const {
  authLimiter,
  accountLoginLimiter,
  adminLoginLimiter,
  refreshLimiter,
  forgotLimiter,
  phoneCodeLimiter,
  linkLimiter,
} = require('../middleware/rateLimit');

// Mounted at /api
router.post('/signup', authLimiter, signup);
router.post('/login', authLimiter, accountLoginLimiter, login);
// Sign in or sign up with a code to your phone. Each step is rate limited by address, and texting a
// code has its own tighter limit (each text costs money).
const phoneSignIn = require('../controllers/phoneSignInController');
router.post('/auth/phone/request', phoneCodeLimiter, phoneSignIn.requestCode);
router.post('/auth/phone/verify', authLimiter, phoneSignIn.verifyCode);
router.post('/auth/phone/signup', authLimiter, phoneSignIn.createAccount);
// Continue with Google (only when configured; see services/googleSignInService.js). The callback path
// must match the redirect address registered with Google (googleSignInService redirectUri).
const googleSignIn = require('../controllers/googleSignInController');
router.get('/auth/google', authLimiter, googleSignIn.start);
router.get('/auth/google/callback', authLimiter, googleSignIn.callback);
// Continue with Facebook (only when configured; see services/facebookSignInService.js).
const facebookSignIn = require('../controllers/facebookSignInController');
router.get('/auth/facebook', authLimiter, facebookSignIn.start);
router.get('/auth/facebook/callback', authLimiter, facebookSignIn.callback);
router.post('/admin/login', adminLoginLimiter, accountLoginLimiter, adminLogin);
router.post(
  '/admin/login/2fa',
  adminLoginLimiter,
  require('../controllers/authController').adminLoginTwoFactor,
);
// Forgotten password, and confirming an email: the links in the emails lead to pages that call these.
router.post('/password/forgot', forgotLimiter, recovery.forgotPassword);
router.post('/password/reset', linkLimiter, recovery.resetPassword);
router.post('/email/verify', linkLimiter, recovery.verifyEmail);
// Renewing the session. It takes no access token: the refresh cookie is the proof, and this is the
// only path that cookie is sent to. Both the store and the admin console use it.
router.post('/auth/refresh', refreshLimiter, refresh);
router.get('/me', requireAuth, me);
router.post('/logout', logout);
router.post('/admin/logout', adminLogout);

module.exports = router;
