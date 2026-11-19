// Price-drop alerts for signed-in customers: start and stop watching a product (see services/priceAlertService.js).
const priceAlertService = require('../services/priceAlertService');
const {asyncHandler} = require('../utils/http');

const start = asyncHandler(async (req, res) => {
  res.json(await priceAlertService.watch(req.user._id, req.params.id));
});

const stop = asyncHandler(async (req, res) => {
  res.json(await priceAlertService.unwatch(req.user._id, req.params.id));
});

module.exports = {start, stop};
