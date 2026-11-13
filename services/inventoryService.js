// Inventory: the stock view of the catalogue. Products is where a product is written; this is
// where its stock is watched and corrected. Money is in paise.
//
// Stock is changed with one atomic update ($inc for "add" and "remove", $set for "count"), so a
// correction can never race with a checkout that is taking the same units.
const mongoose = require("mongoose");
const Product = require("../models/Product");
const Category = require("../models/Category");
const { LOW_STOCK_LIMIT } = require("../config/catalog");
const { HttpError } = require("../utils/http");
const { escapeRegex, toPositiveInt } = require("./productService");

const PAGE_SIZE = 20;
const MAX_STOCK = 100000;
const STATUSES = ["all", "out", "low", "healthy", "unlisted"];
const STATUS_LABELS = { all: "All", out: "Out of stock", low: "Low stock", healthy: "Well stocked", unlisted: "Unlisted" };
const SORTS = {
  stock_asc: { label: "Stock: lowest first", order: { stock: 1, name: 1 } },
  stock_desc: { label: "Stock: highest first", order: { stock: -1, name: 1 } },
  value_desc: { label: "Stock value: highest first", order: { stockValue: -1, name: 1 } },
  name_asc: { label: "Name: A to Z", order: { name: 1 } },
  updated: { label: "Recently changed", order: { updatedAt: -1 } }
};
// What the three "needs attention" bands mean, in one place.
const BANDS = {
  out: { stock: 0 },
  low: { stock: { $gt: 0, $lte: LOW_STOCK_LIMIT } },
  healthy: { stock: { $gt: LOW_STOCK_LIMIT } }
};

function stateOf(product) {
  if (product.stock <= 0) return "out";
  return product.stock <= LOW_STOCK_LIMIT ? "low" : "healthy";
}

function readFilters(query = {}) {
  return {
    q: typeof query.q === "string" ? query.q.trim().slice(0, 80) : "",
    category: typeof query.category === "string" && mongoose.isValidObjectId(query.category) ? query.category : "",
    status: STATUSES.includes(query.status) ? query.status : "all",
    sort: Object.hasOwn(SORTS, query.sort) ? query.sort : "stock_asc",
    page: toPositiveInt(query.page, 1)
  };
}

function filterFrom(filters) {
  const filter = {};
  if (filters.q) filter.$or = [{ name: new RegExp(escapeRegex(filters.q), "i") }, { brand: new RegExp(escapeRegex(filters.q), "i") }];
  if (filters.category) filter.category = filters.category;
  if (filters.status === "unlisted") filter.isListed = false;
  else if (BANDS[filters.status]) Object.assign(filter, { isListed: true }, BANDS[filters.status]);
  return filter;
}

function toRow(product) {
  return {
    id: String(product._id),
    name: product.name,
    brand: product.brand || "",
    image: product.image,
    category: product.category && product.category.name ? product.category.name : "",
    stock: product.stock,
    basePrice: product.basePrice,
    price: product.price,
    // What the units on the shelf are worth at the selling price.
    stockValue: product.stock * product.price,
    isListed: product.isListed !== false,
    state: stateOf(product),
    updatedAt: product.updatedAt
  };
}

// The four counters above the table, over the whole catalogue (not just this page).
async function totals() {
  const [bands] = await Product.aggregate([
    { $group: {
      _id: null,
      products: { $sum: 1 },
      listed: { $sum: { $cond: [{ $ne: ["$isListed", false] }, 1, 0] } },
      units: { $sum: "$stock" },
      value: { $sum: { $multiply: ["$stock", "$price"] } },
      out: { $sum: { $cond: [{ $and: [{ $ne: ["$isListed", false] }, { $lte: ["$stock", 0] }] }, 1, 0] } },
      low: { $sum: { $cond: [{ $and: [{ $ne: ["$isListed", false] }, { $gt: ["$stock", 0] }, { $lte: ["$stock", LOW_STOCK_LIMIT] }] }, 1, 0] } }
    } }
  ]);
  const base = bands || { products: 0, listed: 0, units: 0, value: 0, out: 0, low: 0 };
  return { ...base, lowStockLimit: LOW_STOCK_LIMIT };
}

async function listInventory(query = {}) {
  const filters = readFilters(query);
  const filter = filterFrom(filters);
  // stockValue is worked out in the query, so sorting by it stays a database job.
  const pipeline = [
    { $match: filter },
    { $addFields: { stockValue: { $multiply: ["$stock", "$price"] } } },
    { $sort: SORTS[filters.sort].order },
    { $skip: (filters.page - 1) * PAGE_SIZE },
    { $limit: PAGE_SIZE },
    { $lookup: { from: "categories", localField: "category", foreignField: "_id", as: "category", pipeline: [{ $project: { name: 1 } }] } },
    { $addFields: { category: { $first: "$category" } } }
  ];
  const [rows, total, sums, categories] = await Promise.all([
    Product.aggregate(pipeline),
    Product.countDocuments(filter),
    totals(),
    Category.find().sort({ sortOrder: 1, name: 1 }).select("name").lean()
  ]);
  return {
    products: rows.map(toRow),
    filters,
    totals: sums,
    categories,
    sorts: SORTS,
    statusLabels: STATUS_LABELS,
    pagination: { page: filters.page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), total, limit: PAGE_SIZE }
  };
}

// Changes one product's stock. action: "add" | "remove" | "count" (count sets the exact number).
// Returns the stock before and after, for the audit log.
async function adjustStock(productId, { action, units, note = "" }) {
  if (!mongoose.isValidObjectId(productId)) throw new HttpError(404, "Product not found.");
  const before = await Product.findById(productId).select("name stock variants").lean();
  if (!before) throw new HttpError(404, "Product not found.");
  // Stock of a product with sizes lives on each size; its total is their sum (models/Product.js).
  if (before.variants && before.variants.length) {
    throw new HttpError(400, `${before.name} has sizes or colours. Change each one's stock on the product's edit page.`, null, "has_options");
  }

  let filter = { _id: productId, "variants.0": { $exists: false } };
  let update;
  if (action === "add") {
    filter = { _id: productId, stock: { $lte: MAX_STOCK - units } };
    update = { $inc: { stock: units } };
  } else if (action === "remove") {
    // Only takes units that are really there, so stock can never go negative.
    filter = { _id: productId, stock: { $gte: units } };
    update = { $inc: { stock: -units } };
  } else {
    update = { $set: { stock: units } };
  }

  const product = await Product.findOneAndUpdate(filter, update, { new: true }).populate("category", "name");
  if (!product) {
    if (action === "remove") throw new HttpError(400, `${before.name} only has ${before.stock} in stock.`);
    throw new HttpError(400, `Stock can't go above ${MAX_STOCK.toLocaleString("en-IN")}.`);
  }
  return { product: toRow(product), before: before.stock, after: product.stock, note };
}

// Every product that matches the filters, for the CSV export (no paging).
function cursorFor(query = {}) {
  const filters = readFilters(query);
  return {
    filters,
    cursor: Product.find(filterFrom(filters))
      .sort(SORTS[filters.sort].order)
      .select("name brand stock basePrice price isListed category updatedAt")
      .populate("category", "name")
      .lean()
      .cursor()
  };
}

module.exports = { PAGE_SIZE, MAX_STOCK, STATUSES, STATUS_LABELS, SORTS, stateOf, readFilters, totals, listInventory, adjustStock, cursorFor };
