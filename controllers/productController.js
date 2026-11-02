const productService = require("../services/productService");
const { HttpError, asyncHandler } = require("../utils/http");

// GET /api/products?q=&category=&min=&max=&inStock=1&sort=&page=
const listProducts = asyncHandler(async (req, res) => {
  const { products, pagination, filters } = await productService.listProducts(req.query);
  res.json({ products: products.map(productService.toPublicProduct), pagination, filters });
});

// GET /api/products/search?q=
const searchProducts = asyncHandler(async (req, res) => {
  if (typeof req.query.q !== "string" || !req.query.q.trim()) {
    throw new HttpError(400, "Enter something to search for.");
  }
  return listProducts(req, res);
});

// GET /api/products/:id   (accepts the product id or its slug)
const getProduct = asyncHandler(async (req, res) => {
  const product = await productService.getProduct(req.params.id);
  if (!product) throw new HttpError(404, "Product not found.");
  res.json({ product: productService.toPublicProduct(product) });
});

// GET /api/categories
const listCategories = asyncHandler(async (req, res) => {
  res.json({ categories: await productService.getCategorySummaries() });
});

module.exports = { listProducts, searchProducts, getProduct, listCategories };
