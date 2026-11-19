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
};
