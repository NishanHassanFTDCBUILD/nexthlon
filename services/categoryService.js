const mongoose = require('mongoose');
const Category = require('../models/Category');
const Product = require('../models/Product');
const {PRICE_PIPELINE} = require('../utils/pricing');
const {CATEGORIES} = require('../config/catalog');
const {slugify} = require('../utils/slug');
const {HttpError} = require('../utils/http');
const {LISTED_CATEGORY} = require('../utils/queryFilters');
const memo = require('../utils/memo');

// The listed categories are read on every page (header, menus), so they are kept in memory
// for a short time. Any admin change clears this straight away.
const CACHE_MS = 30 * 1000;
let cache = null;

function invalidate() {
  cache = null;
  // Category names, photos and offers show on the home page and in related products too.
  memo.forget('catalog:');
}

async function listedCategories() {
  if (cache && cache.expires > Date.now()) return cache.list;
  const list = await Category.find({...LISTED_CATEGORY})
    .sort({sortOrder: 1, name: 1})
    .select('name slug image offerPercent')
    .lean();
  cache = {list, expires: Date.now() + CACHE_MS};
  return list;
}

// A listed category by its slug, or null. Hidden categories behave as if they do not exist.
async function findListedBySlug(slug) {
  const key = String(slug || '')
    .trim()
    .toLowerCase();
  if (!key || key.length > 80) return null;
  return Category.findOne({slug: key, ...LISTED_CATEGORY}).lean();
}

async function uniqueCategorySlug(name, exceptId) {
  const base = slugify(name);
  for (let n = 1; n < 500; n += 1) {
    const slug = n === 1 ? base : `${base}-${n}`;
    const taken = await Category.exists(
      exceptId ? {slug, _id: {$ne: exceptId}} : {slug},
    );
    if (!taken) return slug;
  }
  return `${base}-${Date.now().toString(36)}`;
}

// Creates a category by name, or returns the one that already has that name (any letter case).
async function ensureCategory(name, image = '') {
  const clean = String(name).trim();
  const existing = await Category.findOne({nameKey: clean.toLowerCase()});
  if (existing) return existing;
  try {
    return await Category.create({
      name: clean,
      slug: await uniqueCategorySlug(clean),
      image,
    });
  } catch (error) {
    if (error.code === 11000)
      return Category.findOne({nameKey: clean.toLowerCase()});
    throw error;
  }
}

// One-time upgrade: products used to store the category as plain text ("Running").
// Creates the categories and points every product at its category record.
async function migrateProductCategories() {
  if (!(await Category.estimatedDocumentCount())) {
    for (const [index, name] of CATEGORIES.entries()) {
      const category = await ensureCategory(name);
      if (!category.sortOrder)
        await Category.updateOne(
          {_id: category._id},
          {$set: {sortOrder: index}},
        );
    }
  }
  const names = await Product.collection.distinct('category', {
    category: {$type: 'string'},
  });
  for (const name of names) {
    const sample = await Product.collection.findOne(
      {category: name},
      {projection: {image: 1}},
    );
    const category = await ensureCategory(name, sample ? sample.image : '');
    await Product.collection.updateMany(
      {category: name},
      {$set: {category: category._id}},
    );
    await syncProducts(category);
  }
  // Categories without a picture borrow one from their best-selling-looking product.
  const bare = await Category.find({image: ''}).lean();
  for (const category of bare) {
    const sample = await Product.findOne({category: category._id})
      .sort({discountPercent: -1})
      .select('image')
      .lean();
    if (sample)
      await Category.updateOne(
        {_id: category._id},
        {$set: {image: sample.image}},
      );
  }
  invalidate();
}

async function getCategory(categoryId) {
  if (!mongoose.isValidObjectId(categoryId))
    throw new HttpError(404, 'Category not found.');
  const category = await Category.findById(categoryId);
  if (!category) throw new HttpError(404, 'Category not found.');
  return category;
}

// A category's offer or visibility changed: copy it onto its products and redo their prices.
function syncProducts(category) {
  return Product.updateMany({category: category._id}, [
    {
      $set: {
        categoryOffer: category.offerPercent || 0,
        categoryListed: category.isListed !== false,
      },
    },
    ...PRICE_PIPELINE,
  ]);
}

module.exports = {
  syncProducts,
  invalidate,
  listedCategories,
  findListedBySlug,
  uniqueCategorySlug,
  ensureCategory,
  migrateProductCategories,
  getCategory,
};
