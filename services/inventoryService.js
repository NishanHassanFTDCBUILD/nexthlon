// Inventory: the stock view of the catalogue. Products is where a product is written; this is
// where its stock is watched and corrected. Money is in paise.
//
// Stock is changed with one atomic update ($inc for "add" and "remove", $set for "count"), so a
// correction can never race with a checkout that is taking the same units.
const mongoose = require('mongoose');
const Product = require('../models/Product');
const Category = require('../models/Category');
const StockAlert = require('../models/StockAlert');
const Order = require('../models/Order');
const AuditLog = require('../models/AuditLog');
const {RULES} = require('../config/catalog');
const {HttpError} = require('../utils/http');
const {optionLabel} = require('../utils/options');
const {readListQuery} = require('../utils/listQuery');

const PAGE_SIZE = 20;
const MAX_STOCK = 100000;
const STATUSES = ['all', 'out', 'low', 'healthy', 'unlisted'];
const STATUS_LABELS = {
  all: 'All',
  out: 'Out of stock',
  low: 'Low stock',
  healthy: 'Well stocked',
  unlisted: 'Unlisted',
};
const SORTS = {
  stock_asc: {label: 'Stock: lowest first', order: {stock: 1, name: 1}},
  stock_desc: {label: 'Stock: highest first', order: {stock: -1, name: 1}},
  value_desc: {
    label: 'Stock value: highest first',
    order: {stockValue: -1, name: 1},
  },
  name_asc: {label: 'Name: A to Z', order: {name: 1}},
  updated: {label: 'Recently changed', order: {updatedAt: -1}},
};
// What the three "needs attention" bands mean, in one place.
// Worked out on each use, because the low-stock level is an admin setting.
const BANDS = {
  out: {stock: 0},
  get low() {
    return {stock: {$gt: 0, $lte: RULES.lowStockLimit}};
  },
  get healthy() {
    return {stock: {$gt: RULES.lowStockLimit}};
  },
};

function stateOf(product) {
  if (product.stock <= 0) return 'out';
  return product.stock <= RULES.lowStockLimit ? 'low' : 'healthy';
}

function readInventoryList(query = {}) {
  return readListQuery(query, {
    pageSize: PAGE_SIZE,
    searchMax: 80,
    searchFields: ['name', 'brand'],
    defaultSort: 'stock_asc',
    sorts: SORTS,
    fields: {
      category: {
        validate: mongoose.isValidObjectId,
        label: 'Category',
        match: (value) => ({category: new mongoose.Types.ObjectId(value)}),
      },
      status: {
        values: STATUSES,
        default: 'all',
        label: 'Status',
        labels: STATUS_LABELS,
        match: (value) => {
          if (value === 'unlisted') return {isListed: false};
          return BANDS[value] ? {isListed: true, ...BANDS[value]} : {};
        },
      },
    },
  });
}
function readFilters(query = {}) {
  const {limit: _limit, ...filters} = readInventoryList(query).filters;
  return filters;
}

function filterFrom(filters) {
  return readInventoryList(filters).mongo;
}

function toRow(product) {
  // Sizes and colours, each with its own stock and state, for the per-size rows.
  const options = (product.variants || []).map((option) => ({
    id: String(option._id),
    label: optionLabel(option),
    sku: option.sku || '',
    stock: option.stock,
    state: stateOf(option),
  }));
  return {
    options,
    id: String(product._id),
    name: product.name,
    brand: product.brand || '',
    image: product.image,
    category:
      product.category && product.category.name ? product.category.name : '',
    stock: product.stock,
    basePrice: product.basePrice,
    price: product.price,
    // What the units on the shelf are worth at the selling price.
    stockValue: product.stock * product.price,
    isListed: product.isListed !== false,
    state: stateOf(product),
    updatedAt: product.updatedAt,
  };
}

// Units sold in the last 30 days for these products (cancelled and returned items do not count).
const SOLD_DAYS = 30;
async function soldLast30(productIds, now = new Date()) {
  if (!productIds.length) return new Map();
  const since = new Date(now.getTime() - SOLD_DAYS * 24 * 60 * 60 * 1000);
  const rows = await Order.aggregate([
    {$match: {createdAt: {$gte: since}}},
    {$unwind: '$items'},
    {
      $match: {
        'items.product': {$in: productIds},
        'items.status': {$nin: ['cancelled', 'returned']},
      },
    },
    {$group: {_id: '$items.product', units: {$sum: '$items.quantity'}}},
  ]);
  return new Map(rows.map((row) => [String(row._id), row.units]));
}

// Days of stock left at the recent pace: stock ÷ (units sold per day). null when nothing sold.
function daysOfCover(stock, units) {
  if (!units) return null;
  return Math.round((stock / (units / SOLD_DAYS)) * 10) / 10;
}

// The four counters above the table, over the whole catalogue (not just this page).
async function totals() {
  const [bands] = await Product.aggregate([
    {
      $group: {
        _id: null,
        products: {$sum: 1},
        listed: {$sum: {$cond: [{$ne: ['$isListed', false]}, 1, 0]}},
        units: {$sum: '$stock'},
        value: {$sum: {$multiply: ['$stock', '$price']}},
        out: {
          $sum: {
            $cond: [
              {$and: [{$ne: ['$isListed', false]}, {$lte: ['$stock', 0]}]},
              1,
              0,
            ],
          },
        },
        low: {
          $sum: {
            $cond: [
              {
                $and: [
                  {$ne: ['$isListed', false]},
                  {$gt: ['$stock', 0]},
                  {$lte: ['$stock', RULES.lowStockLimit]},
                ],
              },
              1,
              0,
            ],
          },
        },
      },
    },
  ]);
  const base = bands || {
    products: 0,
    listed: 0,
    units: 0,
    value: 0,
    out: 0,
    low: 0,
  };
  return {...base, lowStockLimit: RULES.lowStockLimit};
}

async function listInventory(query = {}) {
  const list = readInventoryList(query);
  const {filters, size} = list;
  const filter = list.mongo;
  // stockValue is worked out in the query, so sorting by it stays a database job.
  const pipeline = [
    {$match: filter},
    {$addFields: {stockValue: {$multiply: ['$stock', '$price']}}},
    {$sort: list.order},
    {$skip: list.skip},
    {$limit: size},
    {
      $lookup: {
        from: 'categories',
        localField: 'category',
        foreignField: '_id',
        as: 'category',
        pipeline: [{$project: {name: 1}}],
      },
    },
    {$addFields: {category: {$first: '$category'}}},
  ];
  const [rows, total, sums, categories] = await Promise.all([
    Product.aggregate(pipeline),
    Product.countDocuments(filter),
    totals(),
    Category.find().sort({sortOrder: 1, name: 1}).select('name').lean(),
  ]);
  const sold = await soldLast30(rows.map((row) => row._id));
  const waiting = await StockAlert.aggregate([
    {$match: {product: {$in: rows.map((row) => row._id)}, notifiedAt: null}},
    {$group: {_id: '$product', count: {$sum: 1}}},
  ]);
  const waitingCounts = new Map(
    waiting.map((row) => [String(row._id), row.count]),
  );
  return {
    products: rows.map((row) => ({
      ...toRow(row),
      waiting: waitingCounts.get(String(row._id)) || 0,
      soldLast30: sold.get(String(row._id)) || 0,
      daysOfCover: daysOfCover(row.stock, sold.get(String(row._id)) || 0),
      reorderLevel: row.reorderLevel ?? null,
      needsReorder: row.reorderLevel != null && row.stock <= row.reorderLevel,
    })),
    filters,
    totals: sums,
    categories,
    sorts: SORTS,
    statusLabels: STATUS_LABELS,
    chips: list.chips,
    pagination: list.pagination(total),
  };
}

// One size's (or colour's) stock. The size and the product total change together in one atomic update,
// so the total always stays the sum of the sizes, even while orders are taking units.
//   add / remove: $inc on both, only if the size has room / has the units.
//   count: sets the size to an exact number; the total moves by the difference. The update only applies
//   if the size still holds the number just read, and is retried when an order got in between.
async function adjustOptionStock(before, optionId, {action, units, note}) {
  const productId = before._id;
  const find = () =>
    (before.variants || []).find(
      (option) => String(option._id) === String(optionId),
    );
  let option = find();
  if (!option)
    throw new HttpError(
      400,
      `Choose which size or colour of ${before.name} to change.`,
      null,
      'option_required',
    );
  const label = optionLabel(option);
  let product = null;
  if (action === 'add') {
    product = await Product.findOneAndUpdate(
      {
        _id: productId,
        variants: {
          $elemMatch: {_id: option._id, stock: {$lte: MAX_STOCK - units}},
        },
      },
      {$inc: {'variants.$.stock': units, stock: units}},
      {new: true},
    );
    if (!product)
      throw new HttpError(
        400,
        `Stock can't go above ${MAX_STOCK.toLocaleString('en-IN')}.`,
      );
  } else if (action === 'remove') {
    product = await Product.findOneAndUpdate(
      {
        _id: productId,
        variants: {$elemMatch: {_id: option._id, stock: {$gte: units}}},
      },
      {$inc: {'variants.$.stock': -units, stock: -units}},
      {new: true},
    );
    if (!product) {
      const fresh = await Product.findById(productId).select('variants').lean();
      const now =
        fresh &&
        (fresh.variants || []).find(
          (v) => String(v._id) === String(option._id),
        );
      throw new HttpError(
        400,
        `${before.name} (${label}) only has ${now ? now.stock : 0} in stock.`,
      );
    }
  } else {
    for (let attempt = 0; attempt < 5 && !product; attempt += 1) {
      if (attempt) {
        before = await Product.findById(productId)
          .select('name stock variants')
          .lean();
        option = find();
        if (!option)
          throw new HttpError(
            400,
            'That size or colour was removed. Reload the page.',
          );
      }
      product = await Product.findOneAndUpdate(
        {
          _id: productId,
          variants: {$elemMatch: {_id: option._id, stock: option.stock}},
        },
        {
          $set: {'variants.$.stock': units},
          $inc: {stock: units - option.stock},
        },
        {new: true},
      );
    }
    if (!product)
      throw new HttpError(
        409,
        'Orders are coming in for this size right now. Please try again.',
      );
  }
  await product.populate('category', 'name');
  const after = product.variants.find(
    (v) => String(v._id) === String(option._id),
  );
  return {
    product: toRow(product),
    option: {id: String(option._id), label},
    before: option.stock,
    after: after ? after.stock : 0,
    note,
  };
}

// Changes one product's stock. action: "add" | "remove" | "count" (count sets the exact number).
// For a product with sizes or colours, optionId says which one. Returns the stock before and after,
// for the audit log.
async function adjustStock(
  productId,
  {action, units, note = '', optionId = null},
) {
  if (!mongoose.isValidObjectId(productId))
    throw new HttpError(404, 'Product not found.');
  const before = await Product.findById(productId)
    .select('name stock variants')
    .lean();
  if (!before) throw new HttpError(404, 'Product not found.');
  // Stock of a product with sizes lives on each size; its total is their sum (models/Product.js).
  if (before.variants && before.variants.length)
    return adjustOptionStock(before, optionId, {action, units, note});

  let filter = {_id: productId, 'variants.0': {$exists: false}};
  let update;
  if (action === 'add') {
    filter = {...filter, stock: {$lte: MAX_STOCK - units}};
    update = {$inc: {stock: units}};
  } else if (action === 'remove') {
    // Only takes units that are really there, so stock can never go negative.
    filter = {...filter, stock: {$gte: units}};
    update = {$inc: {stock: -units}};
  } else {
    update = {$set: {stock: units}};
  }

  const product = await Product.findOneAndUpdate(filter, update, {
    new: true,
  }).populate('category', 'name');
  if (!product) {
    if (action === 'remove')
      throw new HttpError(
        400,
        `${before.name} only has ${before.stock} in stock.`,
      );
    throw new HttpError(
      400,
      `Stock can't go above ${MAX_STOCK.toLocaleString('en-IN')}.`,
    );
  }
  return {
    product: toRow(product),
    before: before.stock,
    after: product.stock,
    note,
  };
}

// Every product that matches the filters, for the CSV export (no paging).
function cursorFor(query = {}) {
  const filters = readFilters(query);
  return {
    filters,
    cursor: Product.find(filterFrom(filters))
      .sort(SORTS[filters.sort].order)
      .select(
        'name brand sku stock variants basePrice price isListed category updatedAt',
      )
      .populate('category', 'name')
      .lean()
      .cursor(),
  };
}

async function stockHistory(productId) {
  if (
    !mongoose.isValidObjectId(productId) ||
    !(await Product.exists({_id: productId}))
  )
    throw new HttpError(404, 'Product not found.');
  const rows = await AuditLog.find({
    target: `product:${productId}`,
    action: 'inventory.stock_changed',
  })
    .sort({at: -1, _id: -1})
    .limit(50)
    .populate('actor', 'name')
    .lean();
  return rows.map((row) => ({
    id: String(row._id),
    at: row.at,
    actor: row.actor?.name || 'System',
    before: row.before?.stock,
    after: row.after?.stock,
    action: row.after?.action || '',
    reason: row.after?.reason || 'Stock correction',
    note: row.after?.note || '',
    option: row.after?.option || '',
  }));
}

// The level at which a product needs reordering (null clears it, and the store-wide level applies).
async function setReorderLevel(productId, level) {
  if (!mongoose.isValidObjectId(productId))
    throw new HttpError(404, 'Product not found.');
  if (
    level !== null &&
    (!Number.isInteger(level) || level < 0 || level > MAX_STOCK)
  )
    throw new HttpError(
      400,
      'Enter a whole number from 0 to ' + MAX_STOCK + ', or leave it empty.',
      {
        reorderLevel:
          'Enter a whole number from 0 to ' +
          MAX_STOCK +
          ', or leave it empty.',
      },
    );
  const product = await Product.findById(productId).select('name reorderLevel');
  if (!product) throw new HttpError(404, 'Product not found.');
  const before = product.reorderLevel ?? null;
  product.reorderLevel = level;
  await product.save();
  return {name: product.name, before, after: level};
}

module.exports = {
  setReorderLevel,
  soldLast30,
  daysOfCover,
  stockHistory,
  PAGE_SIZE,
  MAX_STOCK,
  STATUSES,
  STATUS_LABELS,
  SORTS,
  stateOf,
  readFilters,
  totals,
  listInventory,
  adjustStock,
  cursorFor,
};
