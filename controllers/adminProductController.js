const adminProductService = require('../services/adminProductService');
const auditService = require('../services/auditService');
const stockAlertService = require('../services/stockAlertService');
const {
  validateProduct,
  validateRestock,
  hasErrors,
} = require('../utils/validators');
const {HttpError, asyncHandler} = require('../utils/http');

// The form fields are checked here; the service adds photo checks and reports every problem together.
function readForm(req) {
  const body = req.body || {};
  const {errors, value} = validateProduct(body);
  return {value, errors, body, files: req.files || []};
}

// GET /api/admin/products?q=&category=&status=all|active|unlisted|out&sort=&page=
const listProducts = asyncHandler(async (req, res) => {
  res.json(await adminProductService.listAdminProducts(req.query));
});

// GET /api/admin/products/:productId
const getProduct = asyncHandler(async (req, res) => {
  res.json({
    product: await adminProductService.getAdminProduct(req.params.productId),
  });
});

// POST /api/admin/products   multipart: name, description, category, brand, price, mrp, stock, images[], mainImage
// What the audit log keeps of a product: the fields people change, never photos or internals.
const snapshot = (p) =>
  p && {
    name: p.name,
    price: p.price,
    mrp: p.mrp,
    stock: p.stock,
    isListed: p.isListed,
    offerPercent: p.offerPercent,
    category: p.categoryName || p.category,
  };

const createProduct = asyncHandler(async (req, res) => {
  const product = await adminProductService.createProduct(readForm(req));
  await auditService.record({
    ...auditService.fromRequest(req),
    action: 'product.created',
    target: `product:${product.id}`,
    after: snapshot(product),
  });
  res.status(201).json({message: `${product.name} has been added.`, product});
});

// PATCH /api/admin/products/:productId   multipart: the same fields, plus keepImages (JSON list of photos to keep)
const updateProduct = asyncHandler(async (req, res) => {
  const before = snapshot(
    await adminProductService.getAdminProduct(req.params.productId),
  );
  const product = await adminProductService.updateProduct(
    req.params.productId,
    readForm(req),
  );
  await auditService.record({
    ...auditService.fromRequest(req),
    action: 'product.updated',
    target: `product:${product.id}`,
    before,
    after: snapshot(product),
  });
  // Stock may have come back with the edit; the sweep checks (E3).
  stockAlertService.kick();
  res.json({message: `${product.name} has been saved.`, product});
});

// PATCH /api/admin/products/:productId/listing   body: { "isListed": false }
const setListed = asyncHandler(async (req, res) => {
  const {isListed} = req.body || {};
  if (typeof isListed !== 'boolean')
    throw new HttpError(400, 'isListed must be true or false.');
  const before = snapshot(
    await adminProductService.getAdminProduct(req.params.productId),
  );
  const product = await adminProductService.setListed(
    req.params.productId,
    isListed,
  );
  await auditService.record({
    ...auditService.fromRequest(req),
    action: isListed ? 'product.listed' : 'product.unlisted',
    target: `product:${product.id}`,
    before: {isListed: before.isListed},
    after: {isListed},
  });
  res.json({
    message: isListed
      ? `${product.name} is back in the store.`
      : `${product.name} has been unlisted.`,
    product,
  });
});

// PATCH /api/admin/products/:productId/stock   body: { "add": 10 }   (the dashboard's quick restock)
const restock = asyncHandler(async (req, res) => {
  const {errors, value} = validateRestock(req.body || {});
  if (hasErrors(errors)) throw new HttpError(400, errors.add, errors);
  const {product, before, after} = await adminProductService.restock(
    req.params.productId,
    value.add,
  );
  if (after > before) stockAlertService.kick();
  await auditService.record({
    ...auditService.fromRequest(req),
    action: 'product.restock',
    target: `product:${product.id}`,
    before: {stock: before},
    after: {stock: after},
  });
  res.json({
    message: `${product.name}: ${value.add} added, ${after} in stock now.`,
    product,
  });
});

module.exports = {
  listProducts,
  getProduct,
  createProduct,
  updateProduct,
  setListed,
  restock,
};
