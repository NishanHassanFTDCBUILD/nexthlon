const router = require('express').Router();
const {
  getProfile,
  updateProfile,
  changePassword,
} = require('../controllers/profileController');
const {requireAuth, requireRole} = require('../middleware/auth');
const {sensitiveLimiter} = require('../middleware/rateLimit');

// Mounted at /api/profile. Every route here needs a signed-in customer.
router.use(requireAuth, requireRole('customer'));
router.get('/', getProfile);
router.patch(
  '/fit',
  require('../utils/http').asyncHandler(async (req, res) => {
    const fitProfile = await require('../services/fitProfileService').update(
      req.user._id,
      req.body,
    );
    res.json({
      message: 'Your sports and size preferences are saved.',
      fitProfile,
    });
  }),
);
router.patch('/', updateProfile);
router.patch('/password', sensitiveLimiter, changePassword);

module.exports = router;
