const router = require('express').Router();
const orders = require('../controllers/orderController');
const {requireAuth, requireRole} = require('../middleware/auth');
const {returnPhotos} = require('../middleware/upload');
const {orderLimiter, trackLimiter} = require('../middleware/rateLimit');
const orderTracking = require('../controllers/orderTrackingController');

// Mounted at /api. Checkout and orders are for signed-in customers only.
const customer = [requireAuth, requireRole('customer')];
router.post('/checkout/quote', customer, orders.quote);
// Buy now: one product checked out on its own; the cart is left as it is.
router.post('/buy-now', customer, orderLimiter, orders.buyNow);
router.post('/orders', customer, orderLimiter, orders.placeOrder);
// Guest tracking: no sign-in, rate limited; the same answer for a wrong ID or phone.
router.post('/orders/track', trackLimiter, orderTracking.track);
router.get('/orders', customer, orders.listOrders);
router.get('/orders/:orderId', customer, orders.getOrder);
router.post('/orders/:orderId/cancel', customer, orders.cancelOrder);
router.post(
  '/orders/:orderId/items/:itemId/cancel',
  customer,
  orders.cancelItem,
);
router.post(
  '/orders/:orderId/return',
  customer,
  returnPhotos,
  orders.requestReturn,
);

// Size exchange: swap a delivered item for another size (a signed-in customer; see services/exchangeService.js).
const exchanges = require('../controllers/exchangeController');
router.post(
  '/orders/:orderId/exchange',
  customer,
  orderLimiter,
  exchanges.requestExchange,
);

module.exports = router;
