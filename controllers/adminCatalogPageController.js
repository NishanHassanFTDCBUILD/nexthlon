// Admin pages for the Catalog group (categories, inventory, questions) and for System status.
// Thin handlers: every number comes from a service, and these only choose what the page shows.
const config = require('../config/env');
const inventoryService = require('../services/inventoryService');
const adminCategoryService = require('../services/adminCategoryService');
const questionService = require('../services/questionService');
const systemService = require('../services/systemService');
const {linkBuilder} = require('../utils/queryString');
const {asyncHandler} = require('../utils/http');

const base = (section) => `${config.adminPath}/${section}`;
// The current filters without their defaults, so links stay short.
const without = (filters, defaults) =>
  Object.fromEntries(
    Object.entries(filters).filter(
      ([key, value]) =>
        key !== 'page' &&
        value !== defaults[key] &&
        value !== '' &&
        value !== 0 &&
        value !== 'all',
    ),
  );

// GET <ADMIN_PATH>/inventory
const inventory = asyncHandler(async (req, res) => {
  const data = await inventoryService.listInventory(req.query);
  const current = without(data.filters, {sort: 'stock_asc'});
  res.render('admin/inventory', {
    title: 'Inventory | Nexthlon Admin',
    ...data,
    current,
    link: linkBuilder(base('inventory'), current),
    exportQuery: new URLSearchParams(current).toString(),
  });
});

// GET <ADMIN_PATH>/categories?q=&status=listed|hidden&sort=&page=
const categories = asyncHandler(async (req, res) => {
  const data = await adminCategoryService.listCategories(req.query);
  const current = without(data.filters, {sort: 'order'});
  res.render('admin/categories', {
    title: 'Categories | Nexthlon Admin',
    ...data,
    sorts: adminCategoryService.SORTS,
    current,
    link: linkBuilder(base('categories'), current),
  });
});

// GET <ADMIN_PATH>/categories/new
const categoryNew = (req, res) => {
  res.render('admin/category-form', {
    title: 'New category | Nexthlon Admin',
    category: null,
  });
};

// GET <ADMIN_PATH>/categories/:categoryId/edit
const categoryEdit = asyncHandler(async (req, res) => {
  const category = await adminCategoryService.getCategory(
    req.params.categoryId,
  );
  res.render('admin/category-form', {
    title: `Edit ${category.name} | Nexthlon Admin`,
    category,
  });
});

// GET <ADMIN_PATH>/questions?status=waiting|all|hidden   Product Q&A (E3).
const questions = asyncHandler(async (req, res) => {
  const data = await questionService.adminList({
    status: String(req.query.status || 'waiting'),
    page: req.query.page,
  });
  res.render('admin/questions', {
    title: 'Questions | Nexthlon Admin',
    ...data,
    link: linkBuilder(
      base('questions'),
      data.status === 'waiting' ? {} : {status: data.status},
    ),
  });
});

// GET <ADMIN_PATH>/system
const system = asyncHandler(async (req, res) => {
  res.render('admin/system', {
    title: 'System status | Nexthlon Admin',
    ...(await systemService.status()),
  });
});

module.exports = {
  categories,
  categoryNew,
  categoryEdit,
  questions,
  inventory,
  system,
};
