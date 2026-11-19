const router = require('express').Router();
const wallet = require('../controllers/walletController');
const coupons = require('../controllers/couponController');
const {requireAuth, requireRole} = require('../middleware/auth');

// Mounted at /api. The wallet and coupons are for signed-in customers only.
const customer = [requireAuth, requireRole('customer')];
router.get('/wallet', customer, wallet.getWallet);
router.get('/coupons', customer, coupons.listAvailable);
router.post('/checkout/coupon', customer, coupons.apply);
router.delete('/checkout/coupon', customer, coupons.remove);
// Gift cards: redeem a code into the wallet (one code, once).
const giftCards = require('../controllers/giftCardController');
const {sensitiveLimiter} = require('../middleware/rateLimit');
router.post(
  '/wallet/gift-cards/redeem',
  customer,
  sensitiveLimiter,
  giftCards.redeem,
);

module.exports = router;
