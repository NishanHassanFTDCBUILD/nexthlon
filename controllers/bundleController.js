const bundleService = require('../services/bundleService');
const {asyncHandler} = require('../utils/http');

const forProduct = asyncHandler(async (req, res) => {
  res.json({bundles: await bundleService.forProduct(req.params.productId)});
});
const addAll = asyncHandler(async (req, res) => {
  const result = await bundleService.addAll(req.user, req.params.slug);
  res.json(result);
});
module.exports = {forProduct, addAll};
