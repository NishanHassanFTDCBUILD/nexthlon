// The product spreadsheet: export the catalogue, preview an edited file, then apply it.
// Routes are in routes/adminRoutes.js. Service: services/productCsvService.js.
const productCsvService = require('../services/productCsvService');
const auditService = require('../services/auditService');
const {asyncHandler, HttpError} = require('../utils/http');

// GET /api/admin/products/export.csv
const exportProducts = asyncHandler(async (req, res) => {
  const csv = await productCsvService.exportCsv();
  res
    .set('Cache-Control', 'no-store')
    .attachment(
      `nexthlon-products-${new Date().toISOString().slice(0, 10)}.csv`,
    )
    .type('text/csv')
    .send(csv);
});

// POST /api/admin/products/import/preview   body: { csv }   Saves nothing.
const previewImport = asyncHandler(async (req, res) => {
  res.json(await productCsvService.preview((req.body || {}).csv));
});

// POST /api/admin/products/import/apply   body: { csv }
const applyImport = asyncHandler(async (req, res) => {
  const result = await productCsvService.apply(
    (req.body || {}).csv,
    auditService.fromRequest(req),
  );
  if (!result.saved)
    throw new HttpError(
      400,
      'Nothing changed: every row already matches the store.',
    );
  res.json({
    message: `${result.saved} ${result.saved === 1 ? 'product' : 'products'} updated.`,
    ...result,
  });
});

module.exports = {exportProducts, previewImport, applyImport};
