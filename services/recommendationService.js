// "Frequently bought together": the products that most often share an order with this one, from the
// last 180 days of real orders (cancelled and returned orders left out). Only listed, in-stock
// products are suggested. The answer is the same for every visitor, so it is kept for 10 minutes
// (utils/memo.js; any product change clears it). With no orders to learn from, the list is empty and
// the page simply shows its usual "More from this sport" row.
const mongoose = require('mongoose');
const Order = require('../models/Order');
const Product = require('../models/Product');
const memo = require('../utils/memo');
const {LISTED_PRODUCT} = require('../utils/queryFilters');

const WINDOW_DAYS = 180;
const TTL_MS = 10 * 60 * 1000;
const NOT_COUNTED = ['cancelled', 'returned'];

// [{ product, orders }] for one product, most often bought together first.
function boughtTogether(productId, limit = 4) {
  if (!mongoose.isValidObjectId(productId)) return Promise.resolve([]);
  const id = new mongoose.Types.ObjectId(String(productId));
  return memo.remember(`catalog:together:${id}:${limit}`, TTL_MS, async () => {
    const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const rows = await Order.aggregate([
      {
        $match: {
          'items.product': id,
          createdAt: {$gte: since},
          orderStatus: {$nin: NOT_COUNTED},
        },
      },
      // Each other product counts once per order, however many were bought.
      {$project: {others: {$setDifference: ['$items.product', [id]]}}},
      {$unwind: '$others'},
      {$group: {_id: '$others', orders: {$sum: 1}}},
      {$sort: {orders: -1, _id: 1}},
      {$limit: limit * 3},
    ]);
    if (!rows.length) return [];
    const products = await Product.find({
      ...LISTED_PRODUCT,
      stock: {$gt: 0},
      _id: {$in: rows.map((row) => row._id)},
    }).lean();
    const byId = new Map(
      products.map((product) => [String(product._id), product]),
    );
    return rows
      .map((row) => ({product: byId.get(String(row._id)), orders: row.orders}))
      .filter((entry) => entry.product)
      .slice(0, limit);
  });
}

// For a whole cart: products often bought with what is in it, minus what is already in it.
// [product], best first.
async function forCart(productIds, limit = 4) {
  const inCart = new Set(productIds.map(String));
  const lists = await Promise.all(
    [...inCart].slice(0, 10).map((id) => boughtTogether(id, limit)),
  );
  const score = new Map();
  lists.flat().forEach(({product, orders}) => {
    const key = String(product._id);
    if (inCart.has(key)) return;
    const seen = score.get(key);
    score.set(key, {product, orders: (seen ? seen.orders : 0) + orders});
  });
  return [...score.values()]
    .sort(
      (a, b) =>
        b.orders - a.orders ||
        String(a.product._id).localeCompare(String(b.product._id)),
    )
    .slice(0, limit)
    .map((entry) => entry.product);
}

module.exports = {boughtTogether, forCart, WINDOW_DAYS};
