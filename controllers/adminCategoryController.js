// The admin category API. Every change is written to the audit log: a category's offer changes
// prices, and hiding one hides every product in it.
const adminCategoryService = require('../services/adminCategoryService');
const auditService = require('../services/auditService');
const {validateCategory, hasErrors} = require('../utils/validators');
const {HttpError, asyncHandler} = require('../utils/http');

const snapshot = (category) => ({
  name: category.name,
  slug: category.slug,
  offerPercent: category.offerPercent,
  isListed: category.isListed,
  sortOrder: category.sortOrder,
});

function checked(body) {
  const {errors, value} = validateCategory(body);
  if (hasErrors(errors))
    throw new HttpError(400, 'Please fix the highlighted fields.', errors);
  return value;
}

// GET /api/admin/categories?q=&status=&sort=&page=
const listCategories = asyncHandler(async (req, res) => {
  res.json(await adminCategoryService.listCategories(req.query));
});

// GET /api/admin/categories/:categoryId
const getCategory = asyncHandler(async (req, res) => {
  res.json({
    category: await adminCategoryService.getCategory(req.params.categoryId),
  });
});

// POST /api/admin/categories   multipart: name, slug, description, offerPercent, sortOrder, isListed, image
const createCategory = asyncHandler(async (req, res) => {
  const category = await adminCategoryService.createCategory(
    checked(req.body),
    req.files || [],
  );
  await auditService.record({
    ...auditService.fromRequest(req),
    action: 'category.created',
    target: `category:${category.id}`,
    after: snapshot(category),
  });
  res
    .status(201)
    .json({message: `${category.name} has been created.`, category});
});

// PATCH /api/admin/categories/:categoryId   (same fields as create, plus removeImage)
const updateCategory = asyncHandler(async (req, res) => {
  const {before, category} = await adminCategoryService.updateCategory(
    req.params.categoryId,
    checked(req.body),
    req.files || [],
  );
  await auditService.record({
    ...auditService.fromRequest(req),
    action: 'category.updated',
    target: `category:${category.id}`,
    before: snapshot(before),
    after: snapshot(category),
  });
  res.json({message: `${category.name} has been saved.`, category});
});

// PATCH /api/admin/categories/:categoryId/listing   body: { "isListed": false }
const setListed = asyncHandler(async (req, res) => {
  const {isListed} = req.body || {};
  if (typeof isListed !== 'boolean')
    throw new HttpError(400, 'isListed must be true or false.');
  const category = await adminCategoryService.setListed(
    req.params.categoryId,
    isListed,
  );
  await auditService.record({
    ...auditService.fromRequest(req),
    action: isListed ? 'category.shown' : 'category.hidden',
    target: `category:${category.id}`,
    after: {name: category.name, isListed},
  });
  res.json({
    message: isListed
      ? `${category.name} is back in the store, with its products.`
      : `${category.name} and its products are hidden from the store.`,
    category,
  });
});

// DELETE /api/admin/categories/:categoryId   (only when it has no products)
const deleteCategory = asyncHandler(async (req, res) => {
  const category = await adminCategoryService.deleteCategory(
    req.params.categoryId,
  );
  await auditService.record({
    ...auditService.fromRequest(req),
    action: 'category.deleted',
    target: `category:${category.id}`,
    before: snapshot(category),
  });
  res.json({message: `${category.name} has been deleted.`, category});
});

// POST /api/admin/categories/move-products   body: { productIds: [...], categoryId }
// Moves products into another category; their offer, visibility and price follow it.
const moveProducts = asyncHandler(async (req, res) => {
  const {productIds, categoryId} = req.body || {};
  const result = await adminCategoryService.moveProducts(
    productIds,
    categoryId,
  );
  await auditService.record({
    ...auditService.fromRequest(req),
    action: 'category.products_moved',
    target: `category:${result.to.id}`,
    before: {from: result.from},
    after: {to: result.to.name, products: productIds},
  });
  res.json({
    message: `${result.moved} ${result.moved === 1 ? 'product' : 'products'} moved to ${result.to.name}.`,
    ...result,
  });
});

module.exports = {
  listCategories,
  getCategory,
  createCategory,
  updateCategory,
  setListed,
  deleteCategory,
  moveProducts,
};
