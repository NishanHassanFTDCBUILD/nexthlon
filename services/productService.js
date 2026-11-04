const mongoose = require("mongoose");
const Product = require("../models/Product");
const categoryService = require("./categoryService");
const { HttpError } = require("../utils/http");
const { bestOfferFor } = require("../utils/pricing");

const PAGE_SIZE = 12;
// "relevance" ranks by text-search score when there is a search, and by best deals otherwise.
const SORTS = {
  relevance: { label: "Relevance", order: { discountPercent: -1, ratingAverage: -1, name: 1, _id: 1 } },
  price_asc: { label: "Price: low to high", order: { price: 1, _id: 1 } },
  price_desc: { label: "Price: high to low", order: { price: -1, _id: 1 } },
  newest: { label: "Newest first", order: { createdAt: -1, _id: -1 } },
  rating: { label: "Customer rating", order: { ratingAverage: -1, ratingCount: -1, _id: 1 } },
  discount: { label: "Biggest discount", order: { discountPercent: -1, price: 1, _id: 1 } },
  name_asc: { label: "Name: A to Z", order: { name: 1, _id: 1 } }
};
const DISCOUNT_STEPS = [10, 20, 30, 40, 50];
const RATING_STEPS = [4, 3, 2];
const MAX_BRANDS = 20;
const CATEGORY_FIELDS = "name slug offerPercent";

// Stops search text from being read as a regular expression.
function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toPositiveInt(value, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 1 && number <= 10000 ? number : fallback;
}

// Whole rupees from the URL (prices in links stay human: ?min=1000&max=2999).
function toRupees(value) {
  if (value === undefined || value === "" || Array.isArray(value)) return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= 10_000_000 ? number : null;
}

function readList(value, max) {
  const list = (Array.isArray(value) ? value : [value])
    .filter(item => typeof item === "string")
    .map(item => item.trim().slice(0, 60))
    .filter(Boolean);
  return [...new Set(list)].slice(0, max);
}

// Turns raw query values into a safe filter. Bad values are ignored, never trusted.
function readFilters(query = {}) {
  const q = typeof query.q === "string" ? query.q.trim().replace(/\s+/g, " ").slice(0, 80) : "";
  const category = typeof query.category === "string" ? query.category.trim().toLowerCase().slice(0, 80) : "";
  const brands = readList(query.brand, MAX_BRANDS);
  let min = toRupees(query.min);
  let max = toRupees(query.max);
  if (min !== null && max !== null && min > max) [min, max] = [max, min];
  const discount = DISCOUNT_STEPS.includes(Number(query.discount)) ? Number(query.discount) : 0;
  const rating = RATING_STEPS.includes(Number(query.rating)) ? Number(query.rating) : 0;
  const inStock = query.inStock === "1" || query.inStock === "true";
  const sort = typeof query.sort === "string" && Object.hasOwn(SORTS, query.sort) ? query.sort : "relevance";
  const view = query.view === "list" ? "list" : "grid";
  const page = toPositiveInt(query.page, 1);
  return { q, category, brands, min, max, discount, rating, inStock, sort, view, page };
}

// The search part of a query. MongoDB text search handles whole words ("trail shoes");
// when it finds nothing, a plain "contains" match on name, brand and description catches
// partial words ("tra") so suggestions still work while typing.
async function searchClause(base, q) {
  if (!q) return { clause: {}, mode: "none" };
  const text = { $text: { $search: q } };
  if (await Product.exists({ ...base, ...text })) return { clause: text, mode: "text" };
  const pattern = new RegExp(escapeRegex(q), "i");
  return { clause: { $or: [{ name: pattern }, { brand: pattern }, { description: pattern }] }, mode: "contains" };
}

async function listProducts(query) {
  const filters = readFilters(query);
  let category = null;
  if (filters.category) {
    category = await categoryService.findListedBySlug(filters.category);
    if (!category) throw new HttpError(404, "That category is not available.");
  }

  const base = { ...Product.LISTED };
  if (category) base.category = category._id;
  const { clause, mode } = await searchClause(base, filters.q);
  // "scope" is everything the shopper searched for; the facets (brands, price range) come from it,
  // so picking a brand never hides the other brands.
  const scope = { ...base, ...clause };

  const filter = { ...scope };
  if (filters.brands.length) filter.brand = { $in: filters.brands };
  if (filters.min !== null || filters.max !== null) {
    filter.price = {};
    if (filters.min !== null) filter.price.$gte = filters.min * 100;
    if (filters.max !== null) filter.price.$lte = filters.max * 100;
  }
  if (filters.discount) filter.discountPercent = { $gte: filters.discount };
  if (filters.rating) filter.ratingAverage = { $gte: filters.rating };
  if (filters.inStock) filter.stock = { $gt: 0 };

  const useScore = filters.sort === "relevance" && mode === "text";
  const order = useScore ? { score: { $meta: "textScore" }, _id: 1 } : SORTS[filters.sort].order;
  const finder = Product.find(filter, useScore ? { score: { $meta: "textScore" } } : undefined)
    .sort(order)
    .skip((filters.page - 1) * PAGE_SIZE)
    .limit(PAGE_SIZE)
    .populate("category", CATEGORY_FIELDS)
    .lean();

  const [products, total, facets] = await Promise.all([finder, Product.countDocuments(filter), getFacets(scope)]);

  return {
    products,
    category,
    facets,
    filters,
    searchMode: mode,
    pagination: { page: filters.page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), total, limit: PAGE_SIZE }
  };
}

// Brands with counts, and the cheapest and dearest price (in whole rupees) for the price slider.
async function getFacets(scope) {
  const [result] = await Product.aggregate([
    { $match: scope },
    {
      $facet: {
        brands: [{ $group: { _id: "$brand", count: { $sum: 1 } } }, { $sort: { count: -1, _id: 1 } }, { $limit: 30 }],
        range: [{ $group: { _id: null, low: { $min: "$price" }, high: { $max: "$price" } } }]
      }
    }
  ]);
  const range = result && result.range[0];
  return {
    brands: result ? result.brands.filter(b => b._id).map(b => ({ name: b._id, count: b.count })) : [],
    priceLow: range ? Math.floor(range.low / 100) : 0,
    priceHigh: range ? Math.ceil(range.high / 100) : 0
  };
}

// Listed categories that have at least one listed product, with counts and a "from" price.
async function getCategorySummaries() {
  const [categories, groups] = await Promise.all([
    categoryService.listedCategories(),
    Product.aggregate([
      { $match: { ...Product.LISTED } },
      { $sort: { discountPercent: -1 } },
      { $group: { _id: "$category", count: { $sum: 1 }, fromPrice: { $min: "$price" }, image: { $first: "$image" } } }
    ])
  ]);
  const byId = new Map(groups.map(group => [String(group._id), group]));
  return categories
    .filter(category => byId.has(String(category._id)))
    .map(category => {
      const group = byId.get(String(category._id));
      return {
        id: String(category._id),
        name: category.name,
        slug: category.slug,
        offerPercent: category.offerPercent || 0,
        image: category.image || group.image,
        count: group.count,
        fromPrice: group.fromPrice
      };
    });
}

// Accepts a slug like "trailflex-2-trail-running-shoes" or a MongoDB id.
// Unlisted products, and products in unlisted categories, are not found.
async function getProduct(idOrSlug) {
  const key = String(idOrSlug || "").trim().toLowerCase();
  if (!key || key.length > 120) return null;
  const conditions = [{ slug: key }];
  if (mongoose.isValidObjectId(key)) conditions.push({ _id: key });
  return Product.findOne({ $or: conditions, ...Product.LISTED }).populate("category", CATEGORY_FIELDS).lean();
}

function getRelatedProducts(product, limit = 8) {
  const categoryId = product.category && product.category._id ? product.category._id : product.category;
  return Product.find({ ...Product.LISTED, category: categoryId, _id: { $ne: product._id } })
    .sort({ ratingAverage: -1, discountPercent: -1, _id: 1 }).limit(limit).lean();
}

async function getHomeSections() {
  const [deals, newest, categories, brands] = await Promise.all([
    Product.find({ ...Product.LISTED, discountPercent: { $gt: 0 } }).sort({ discountPercent: -1, _id: 1 }).limit(10).lean(),
    Product.find({ ...Product.LISTED }).sort({ createdAt: -1, _id: -1 }).limit(10).lean(),
    getCategorySummaries(),
    Product.distinct("brand", { ...Product.LISTED })
  ]);
  // Best sellers: the best-rated in-stock items that are not already in the deals row
  // (highest price first while there are no ratings yet).
  const bestSellers = await Product.find({
    ...Product.LISTED, stock: { $gt: 0 }, _id: { $nin: deals.map(p => p._id) }
  }).sort({ ratingCount: -1, ratingAverage: -1, price: -1, _id: 1 }).limit(10).lean();
  return { deals, newest, bestSellers, categories, brands: brands.filter(Boolean).sort() };
}

// Listed products for the given ids, in the same order as the ids. Unknown or unlisted ids are skipped.
async function getProductsByIds(ids) {
  if (!ids.length) return [];
  const found = await Product.find({ ...Product.LISTED, _id: { $in: ids } }).populate("category", CATEGORY_FIELDS).lean();
  const byId = new Map(found.map(p => [String(p._id), p]));
  return ids.map(id => byId.get(id)).filter(Boolean);
}

// The offer that set the price, for the price block ("Extra 10% off with the Running offer").
function offerLabel(product) {
  const offer = bestOfferFor(product);
  if (!offer.percent) return null;
  const name = product.category && product.category.name;
  return {
    percent: offer.percent,
    source: offer.source,
    text: offer.source === "category" && name ? `${offer.percent}% ${name} offer applied` : `${offer.percent}% product offer applied`
  };
}

// What the JSON API returns for one product. Money is in paise.
function toPublicProduct(product) {
  const category = product.category && product.category.name ? product.category : null;
  return {
    id: String(product._id),
    slug: product.slug,
    name: product.name,
    category: category ? category.name : "",
    categorySlug: category ? category.slug : "",
    brand: product.brand,
    price: product.price,
    mrp: product.mrp,
    discountPercent: product.discountPercent,
    offer: offerLabel(product),
    stock: product.stock,
    inStock: product.stock > 0,
    rating: { average: product.ratingAverage || 0, count: product.ratingCount || 0 },
    image: product.image,
    gallery: product.gallery,
    description: product.description,
    highlights: product.highlights,
    specs: product.specs || {}
  };
}

module.exports = {
  PAGE_SIZE,
  SORTS,
  DISCOUNT_STEPS,
  RATING_STEPS,
  escapeRegex,
  toPositiveInt,
  readFilters,
  listProducts,
  getFacets,
  getCategorySummaries,
  getProduct,
  getRelatedProducts,
  getHomeSections,
  getProductsByIds,
  offerLabel,
  toPublicProduct
};
