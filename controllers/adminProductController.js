const adminProductService = require("../services/adminProductService");
const { validateProduct } = require("../utils/validators");
const { HttpError, asyncHandler } = require("../utils/http");

// The form fields are checked here; the service adds photo checks and reports every problem together.
function readForm(req) {
  const body = req.body || {};
  const { errors, value } = validateProduct(body);
  return { value, errors, body, files: req.files || [] };
}

// GET /api/admin/products?q=&category=&status=all|active|unlisted|out&sort=&page=
const listProducts = asyncHandler(async (req, res) => {
  res.json(await adminProductService.listAdminProducts(req.query));
});

// GET /api/admin/products/:productId
const getProduct = asyncHandler(async (req, res) => {
  res.json({ product: await adminProductService.getAdminProduct(req.params.productId) });
});

// POST /api/admin/products   multipart: name, description, category, brand, price, mrp, stock, images[], mainImage
const createProduct = asyncHandler(async (req, res) => {
  const product = await adminProductService.createProduct(readForm(req));
  res.status(201).json({ message: `${product.name} has been added.`, product });
});

// PATCH /api/admin/products/:productId   multipart: the same fields, plus keepImages (JSON list of photos to keep)
const updateProduct = asyncHandler(async (req, res) => {
  const product = await adminProductService.updateProduct(req.params.productId, readForm(req));
  res.json({ message: `${product.name} has been saved.`, product });
});

// PATCH /api/admin/products/:productId/listing   body: { "isListed": false }
const setListed = asyncHandler(async (req, res) => {
  const { isListed } = req.body || {};
  if (typeof isListed !== "boolean") throw new HttpError(400, "isListed must be true or false.");
  const product = await adminProductService.setListed(req.params.productId, isListed);
  res.json({
    message: isListed ? `${product.name} is back in the store.` : `${product.name} has been unlisted.`,
    product
  });
});

module.exports = { listProducts, getProduct, createProduct, updateProduct, setListed };
