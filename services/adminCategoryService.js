// Categories, from the admin's side: the list, create and edit, show or hide, and delete.
//
// A category's offer and visibility are copied onto its products (categoryService.syncProducts),
// so changing either one changes the prices and the shop straight away. The shop-side reading of
// categories lives in services/categoryService.js; this file only adds what the admin needs.
const Category = require('../models/Category');
const Product = require('../models/Product');
const categoryService = require('./categoryService');
const imageService = require('./imageService');
const {HttpError} = require('../utils/http');
const {pageSize} = require('../utils/paging');
const {PRICE_PIPELINE} = require('../utils/pricing');
const mongoose = require('mongoose');

const PAGE_SIZE = 20;
const STATUSES = ['all', 'listed', 'hidden'];
const SORTS = {
  order: {label: 'Menu order', order: {sortOrder: 1, name: 1}},
  name: {label: 'Name: A to Z', order: {nameKey: 1}},
  newest: {label: 'Newest first', order: {createdAt: -1}},
  offer: {label: 'Biggest offer', order: {offerPercent: -1, name: 1}},
};

const toPage = (value) => {
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n > 0 && n < 100000 ? n : 1;
};
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function statusFilter(status) {
  if (status === 'listed') return {isListed: true};
  if (status === 'hidden') return {isListed: false};
  return {};
}

function toAdminCategory(category, productCount = 0) {
  return {
    id: String(category._id),
    name: category.name,
    slug: category.slug,
    image: category.image || '',
    description: category.description || '',
    offerPercent: category.offerPercent || 0,
    isListed: category.isListed !== false,
    sortOrder: category.sortOrder || 0,
    productCount,
    createdAt: category.createdAt,
    updatedAt: category.updatedAt,
  };
}

// How many products each of these categories holds.
async function countProducts(ids) {
  if (!ids.length) return new Map();
  const rows = await Product.aggregate([
    {$match: {category: {$in: ids}}},
    {$group: {_id: '$category', count: {$sum: 1}}},
  ]);
  return new Map(rows.map((row) => [String(row._id), row.count]));
}

function readFilters(query = {}) {
  return {
    q: typeof query.q === 'string' ? query.q.trim().slice(0, 40) : '',
    status: STATUSES.includes(query.status) ? query.status : 'all',
    sort: Object.hasOwn(SORTS, query.sort) ? query.sort : 'order',
    page: toPage(query.page),
  };
}

async function listCategories(query = {}) {
  const size = pageSize(query, PAGE_SIZE);
  const filters = readFilters(query);
  filters.limit = size === PAGE_SIZE ? '' : size;
  const filter = statusFilter(filters.status);
  if (filters.q) filter.name = new RegExp(escapeRegex(filters.q), 'i');
  const [rows, total, listed, hidden] = await Promise.all([
    Category.find(filter)
      .sort(SORTS[filters.sort].order)
      .skip((filters.page - 1) * size)
      .limit(size)
      .lean(),
    Category.countDocuments(filter),
    Category.countDocuments({isListed: true}),
    Category.countDocuments({isListed: false}),
  ]);
  const counts = await countProducts(rows.map((row) => row._id));
  return {
    categories: rows.map((row) =>
      toAdminCategory(row, counts.get(String(row._id)) || 0),
    ),
    filters,
    totals: {all: listed + hidden, listed, hidden},
    pagination: {
      page: filters.page,
      pages: Math.max(1, Math.ceil(total / size)),
      total,
      limit: size,
    },
  };
}

async function getCategory(categoryId) {
  const category = await categoryService.getCategory(categoryId);
  const counts = await countProducts([category._id]);
  return toAdminCategory(category, counts.get(String(category._id)) || 0);
}

// Names are unique whatever the letter case ("Running" = "running"), and so are slugs.
async function checkUnique(value, exceptId = null) {
  const others = exceptId ? {_id: {$ne: exceptId}} : {};
  const errors = {};
  if (await Category.exists({nameKey: value.name.toLowerCase(), ...others}))
    errors.name = 'A category with this name already exists.';
  if (value.slug && (await Category.exists({slug: value.slug, ...others})))
    errors.slug = 'Another category already uses this link name.';
  if (Object.keys(errors).length)
    throw new HttpError(409, Object.values(errors)[0], errors);
}

// An old category photo is removed from storage only when it was ours and no product shows it
// (category photos are often borrowed from one of their products).
async function forgetImage(url) {
  if (!url) return;
  const inUse = await Product.exists({$or: [{image: url}, {gallery: url}]});
  if (!inUse) await imageService.deleteImages([url]);
}

async function saveUpload(files = []) {
  const file = files[0];
  if (!file) return '';
  const fakes = imageService.findFakeImages([file]);
  if (fakes.length)
    throw new HttpError(
      400,
      'That file is not a real JPG, PNG or WEBP image.',
      {
        image: 'That file is not a real JPG, PNG or WEBP image.',
      },
    );
  const [url] = await imageService.saveImages([file], 'products');
  return url;
}

async function createCategory(value, files = []) {
  await checkUnique(value);
  const image = await saveUpload(files);
  try {
    const category = await Category.create({
      name: value.name,
      slug:
        value.slug || (await categoryService.uniqueCategorySlug(value.name)),
      description: value.description,
      offerPercent: value.offerPercent,
      sortOrder: value.sortOrder,
      isListed: value.isListed,
      image,
    });
    categoryService.invalidate();
    return toAdminCategory(category, 0);
  } catch (error) {
    await imageService.deleteImages([image]);
    if (error.code === 11000)
      throw new HttpError(409, 'A category with this name already exists.', {
        name: 'A category with this name already exists.',
      });
    throw error;
  }
}

async function updateCategory(categoryId, value, files = []) {
  const category = await categoryService.getCategory(categoryId);
  await checkUnique(value, category._id);
  const before = toAdminCategory(category);
  const newImage = await saveUpload(files);
  const oldImage = category.image;

  category.name = value.name;
  if (value.slug) category.slug = value.slug;
  else if (value.name.toLowerCase() !== before.name.toLowerCase())
    category.slug = await categoryService.uniqueCategorySlug(
      value.name,
      category._id,
    );
  category.description = value.description;
  category.offerPercent = value.offerPercent;
  category.sortOrder = value.sortOrder;
  category.isListed = value.isListed;
  if (newImage) category.image = newImage;
  else if (value.removeImage) category.image = '';

  try {
    await category.save();
  } catch (error) {
    await imageService.deleteImages([newImage]);
    throw error;
  }
  if (category.image !== oldImage) await forgetImage(oldImage);
  // The offer and visibility live on every product too, so their prices and the shop follow.
  if (
    before.offerPercent !== category.offerPercent ||
    before.isListed !== category.isListed
  )
    await categoryService.syncProducts(category);
  categoryService.invalidate();
  return {before, category: await getCategory(category._id)};
}

async function setListed(categoryId, isListed) {
  const category = await categoryService.getCategory(categoryId);
  category.isListed = isListed;
  await category.save();
  await categoryService.syncProducts(category);
  categoryService.invalidate();
  return getCategory(category._id);
}

// Only an empty category can be deleted: products must always belong to one. To retire a category
// that still has products, hide it (its products are hidden with it) or move them first.
async function deleteCategory(categoryId) {
  const category = await categoryService.getCategory(categoryId);
  const products = await Product.countDocuments({category: category._id});
  if (products)
    throw new HttpError(
      409,
      `${category.name} still has ${products} ${products === 1 ? 'product' : 'products'}. Move them to another category, or hide this one instead.`,
    );
  const before = toAdminCategory(category);
  await category.deleteOne();
  await forgetImage(category.image);
  categoryService.invalidate();
  return before;
}

// ---------- One category and its products ----------

const PRODUCT_SORTS = {
  name: {label: 'Name: A to Z', order: {name: 1}},
  newest: {label: 'Newest first', order: {createdAt: -1}},
  price_desc: {label: 'Price: high to low', order: {price: -1}},
  stock_asc: {label: 'Lowest stock first', order: {stock: 1}},
};
const MOVE_LIMIT = 200;

const productStatus = (p) =>
  p.isListed === false ? 'unlisted' : (p.stock || 0) <= 0 ? 'out' : 'active';

// The category page: its details, and one page of its products with search and sort.
async function categoryProducts(categoryId, query = {}) {
  const category = await getCategory(categoryId);
  const size = pageSize(query, PAGE_SIZE);
  const filters = {
    q: typeof query.q === 'string' ? query.q.trim().slice(0, 60) : '',
    sort: Object.hasOwn(PRODUCT_SORTS, query.sort) ? query.sort : 'name',
    page: toPage(query.page),
    limit: size === PAGE_SIZE ? '' : size,
  };
  const filter = {category: category.id};
  if (filters.q) filter.name = new RegExp(escapeRegex(filters.q), 'i');
  const [rows, total, others, stats] = await Promise.all([
    Product.find(filter)
      .sort(PRODUCT_SORTS[filters.sort].order)
      .skip((filters.page - 1) * size)
      .limit(size)
      .select('name slug image brand price mrp stock isListed discountPercent')
      .lean(),
    Product.countDocuments(filter),
    Category.find({_id: {$ne: category.id}})
      .sort({sortOrder: 1, name: 1})
      .select('name isListed')
      .lean(),
    Product.aggregate([
      {$match: {category: new mongoose.Types.ObjectId(category.id)}},
      {
        $group: {
          _id: null,
          listed: {$sum: {$cond: [{$ne: ['$isListed', false]}, 1, 0]}},
          out: {$sum: {$cond: [{$lte: ['$stock', 0]}, 1, 0]}},
          units: {$sum: '$stock'},
        },
      },
    ]),
  ]);
  const totals = stats[0] || {listed: 0, out: 0, units: 0};
  return {
    category,
    products: rows.map((p) => ({
      id: String(p._id),
      name: p.name,
      slug: p.slug,
      image: p.image,
      brand: p.brand || '',
      price: p.price,
      mrp: p.mrp,
      stock: p.stock || 0,
      discountPercent: p.discountPercent || 0,
      status: productStatus(p),
    })),
    otherCategories: others.map((c) => ({
      id: String(c._id),
      name: c.name,
      isListed: c.isListed !== false,
    })),
    totals: {
      products: category.productCount,
      listed: totals.listed,
      out: totals.out,
      units: totals.units,
    },
    filters,
    sorts: PRODUCT_SORTS,
    pagination: {
      page: filters.page,
      pages: Math.max(1, Math.ceil(total / size)),
      total,
      limit: size,
    },
  };
}

// Moves products into another category in one update. Each product takes on its new
// category's offer and visibility, and its price is worked out again.
async function moveProducts(productIds, categoryId) {
  const ids = [
    ...new Set((Array.isArray(productIds) ? productIds : []).map(String)),
  ];
  if (!ids.length || !ids.every((id) => mongoose.isValidObjectId(id)))
    throw new HttpError(400, 'Choose the products to move.');
  if (ids.length > MOVE_LIMIT)
    throw new HttpError(400, `Move up to ${MOVE_LIMIT} products at a time.`);
  if (!mongoose.isValidObjectId(categoryId))
    throw new HttpError(400, 'Choose the category to move them to.', {
      categoryId: 'Choose the category to move them to.',
    });
  const target = await Category.findById(categoryId);
  if (!target)
    throw new HttpError(404, 'That category no longer exists.', {
      categoryId: 'That category no longer exists.',
    });
  const objectIds = ids.map((id) => new mongoose.Types.ObjectId(id));
  const from = await Product.aggregate([
    {$match: {_id: {$in: objectIds}}},
    {$group: {_id: '$category', count: {$sum: 1}}},
  ]);
  const found = from.reduce((sum, row) => sum + row.count, 0);
  if (found !== ids.length)
    throw new HttpError(
      404,
      'Some of these products no longer exist. Reload the page.',
    );
  const result = await Product.updateMany({_id: {$in: objectIds}}, [
    {
      $set: {
        category: target._id,
        categoryOffer: target.offerPercent || 0,
        categoryListed: target.isListed !== false,
      },
    },
    ...PRICE_PIPELINE,
  ]);
  categoryService.invalidate();
  return {
    moved: result.modifiedCount || 0,
    to: {id: String(target._id), name: target.name},
    from: from.map((row) => ({id: String(row._id), count: row.count})),
  };
}

module.exports = {
  PAGE_SIZE,
  STATUSES,
  SORTS,
  listCategories,
  getCategory,
  createCategory,
  updateCategory,
  setListed,
  deleteCategory,
  categoryProducts,
  moveProducts,
  MOVE_LIMIT,
};
