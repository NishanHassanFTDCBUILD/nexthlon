const bundleService = require("../services/bundleService");
const { asyncHandler, HttpError } = require("../utils/http");

const forProduct = asyncHandler(async (req, res) => {
  res.json({ bundles: await bundleService.forProduct(req.params.productId) });
});
const addAll = asyncHandler(async (req, res) => {
  const result = await bundleService.addAll(req.user, req.params.slug);
  res.json(result);
});
// Admin: POST /api/admin/bundles { name, summary, products: [ids], percentOff }
const createBundle = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const products = Array.isArray(body.products) ? body.products.map(String).slice(0, 6) : [];
  const percentOff = Number(body.percentOff);
  if (!Number.isInteger(percentOff) || percentOff < 0 || percentOff > 30) throw new HttpError(400, "Choose a whole percent from 0 to 30.", { percentOff: "Choose 0 to 30." });
  try {
    const bundle = await bundleService.create({ name: String(body.name || "").trim(), summary: String(body.summary || "").trim(), products, percentOff });
    res.status(201).json({ message: "Bundle created.", bundle: { id: String(bundle._id), slug: bundle.slug } });
  } catch (error) {
    if (error.name === "ValidationError") throw new HttpError(400, "Check the bundle: a name, 2 to 6 products and a discount up to 30%.");
    throw error;
  }
});

module.exports = { forProduct, addAll, createBundle };
