const router = require('express').Router();
const account = require('../controllers/accountController');
const {requireAuth, requireRole} = require('../middleware/auth');
const recovery = require('../controllers/recoveryController');
const {sensitiveLimiter} = require('../middleware/rateLimit');

// Mounted at /api/account. Signed-in customers only.
router.use(requireAuth, requireRole('customer'));
router.patch('/email', sensitiveLimiter, account.changeEmail);
router.post('/email/resend', sensitiveLimiter, recovery.resendVerification);
router.post('/logout-all', sensitiveLimiter, account.logoutAll);
// Logged-in devices: one row per live refresh token (see services/refreshTokenService.js).
router.get('/sessions', account.listSessions);
router.delete(
  '/sessions/:sessionId',
  sensitiveLimiter,
  account.endDeviceSession,
);
router.patch('/preferences', account.updatePreferences);
router.delete('/recent', account.clearRecent);
router.get('/export', sensitiveLimiter, account.exportData);
router.post('/delete', sensitiveLimiter, account.deleteAccount);
router.patch('/reviews/:reviewId', account.updateReview);
router.delete('/reviews/:reviewId', account.deleteReview);

module.exports = router;
