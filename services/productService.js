const mongoose = require("mongoose");
const Product = require("../models/Product");
const { CATEGORIES } = require("../config/catalog");

const PAGE_SIZE = 12;
const SORTS = {
  featured: { label: "Featured", order: { discountPercent: -1, name: 1 } },
  newest: { label: "Newest first", order: { createdAt: -1, _id: -1 } },
  price_asc: { label: "Price: low to high", order: { price: 1, _id: 1 } },
  price_desc: { label: "Price: high to low", order: { price: -1, _id: 1 } },
  name_asc: { label: "Name: A to Z", order: { name: 1, _id: 1 } },
  discount: { label: "Biggest discount", order: { discountPercent: -1, price: 1 } }
};

// Stops search text from being read as a regular expression.
function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toPositiveInt(value, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 1 && number <= 10000 ? number : fallback;
}

function toPrice(value) {
  if (value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 10_000_000 ? number : null;
}

// Turns raw query values into a safe filter. Bad values are ignored, not trusted.
function readFilters(query = {}) {
  const q = typeof query.q === "string" ? query.q.trim().slice(0, 80) : "";
  const category = CATEGORIES.includes(query.category) ? query.category : "";
  let min = toPrice(query.min);
  let max = toPrice(query.max);
  if (min !== null && max !== null && min > max) [min, max] = [max, min];
  const inStock = query.inStock === "1" || query.inStock === "true";
  const sort = Object.hasOwn(SORTS, query.sort) ? query.sort : "featured";
  const page = toPositiveInt(query.page, 1);
  return { q, category, min, max, inStock, sort, page };
}

async function listProducts(query) {
  const filters = readFilters(query);
  const filter = { ...Product.LISTED };
  if (filters.q) {
    const pattern = new RegExp(escapeRegex(filters.q), "i");
    filter.$or = [{ name: pattern }, { brand: pattern }, { category: pattern }, { description: pattern }];
  }
  if (filters.category) filter.category = filters.category;
  if (filters.min !== null || filters.max !== null) {
    filter.price = {};
    if (filters.min !== null) filter.price.$gte = filters.min;
    if (filters.max !== null) filter.price.$lte = filters.max;
  }
  if (filters.inStock) filter.stock = { $gt: 0 };

  const [products, total] = await Promise.all([
    Product.find(filter)
      .sort(SORTS[filters.sort].order)
      .skip((filters.page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .lean(),
    Product.countDocuments(filter)
  ]);

  return {
    products,
    filters,
    pagination: { page: filters.page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), total, limit: PAGE_SIZE }
  };
}

async function getCategorySummaries() {
  const groups = await Product.aggregate([
    { $match: { ...Product.LISTED } },
    { $sort: { discountPercent: -1 } },
    { $group: { _id: "$category", count: { $sum: 1 }, fromPrice: { $min: "$price" }, image: { $first: "$image" } } }
  ]);
  const byName = new Map(groups.map(group => [group._id, group]));
  return CATEGORIES
    .filter(name => byName.has(name))
    .map(name => ({ name, ...byName.get(name), _id: undefined }));
}

// Accepts a slug like "trailflex-2-trail-running-shoes" or a MongoDB id.
async function getProduct(idOrSlug) {
  const key = String(idOrSlug || "").trim().toLowerCase();
  if (!key || key.length > 120) return null;
  const conditions = [{ slug: key }];
  if (mongoose.isValidObjectId(key)) conditions.push({ _id: key });
  return Product.findOne({ $or: conditions, ...Product.LISTED }).lean();
}

function getRelatedProducts(product, limit = 4) {
  return Product.find({ ...Product.LISTED, category: product.category, _id: { $ne: product._id } })
    .sort({ discountPercent: -1 }).limit(limit).lean();
}

async function getHomeSections() {
  const [deals, newest, categories] = await Promise.all([
    Product.find({ ...Product.LISTED, discountPercent: { $gt: 0 } }).sort({ discountPercent: -1 }).limit(8).lean(),
    Product.find({ ...Product.LISTED }).sort({ createdAt: -1, _id: -1 }).limit(8).lean(),
    getCategorySummaries()
  ]);
  return { deals, newest, categories };
}

// What the JSON API returns for one product.
function toPublicProduct(product) {
  return {
    id: String(product._id),
    slug: product.slug,
    name: product.name,
    category: product.category,
    brand: product.brand,
    price: product.price,
    mrp: product.mrp,
    discountPercent: product.discountPercent,
    stock: product.stock,
    inStock: product.stock > 0,
    image: product.image,
    gallery: product.gallery,
    description: product.description,
    highlights: product.highlights,
    specs: product.specs || {}
  };
}

module.exports = {
  SORTS,
  escapeRegex,
  toPositiveInt,
  readFilters,
  listProducts,
  getCategorySummaries,
  getProduct,
  getRelatedProducts,
  getHomeSections,
  toPublicProduct
};
