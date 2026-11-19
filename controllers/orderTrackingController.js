// Guest order tracking (public): POST /api/orders/track with { orderId, phone }.
const orderTrackingService = require('../services/orderTrackingService');
const {asyncHandler} = require('../utils/http');

const track = asyncHandler(async (req, res) => {
  res.json(await orderTrackingService.track(req.body || {}));
});

module.exports = {track};
