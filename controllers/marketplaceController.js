// Stock sync from a marketplace (E8). POST /api/webhooks/marketplace-stock  { sku, stock }  with x-api-key.
const marketplaceService = require('../services/marketplaceService');
const {asyncHandler, HttpError} = require('../utils/http');

const stockSync = asyncHandler(async (req, res) => {
  if (!marketplaceService.authorised(req.get('x-api-key')))
    throw new HttpError(401, 'Unauthorised.');
  const result = await marketplaceService.syncStock(
    req.body && req.body.sku,
    req.body && req.body.stock,
  );
  res.json({ok: true, ...result});
});

module.exports = {stockSync};
