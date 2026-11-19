const Product = require('../models/Product');
const {HttpError} = require('../utils/http');
const {supportsTransactions, inTransaction} = require('../utils/transaction');
const {LISTED_PRODUCT} = require('../utils/queryFilters');

// Taking stock is ATOMIC per product: "$inc stock by -qty, but only if stock >= qty" is one
// database operation, so two shoppers can never both buy the last item and stock never goes
// below 0. Several products are taken inside a MongoDB transaction when the server supports it
// (a replica set); on a single server, the ones already taken are put back if a later one fails.

// A line for a product with sizes or colours names its option (line.variant): its stock and the
// product's total are changed in the same single update, only if that option still has enough. So two
// shoppers can never both take the last size 9, and the total always equals the sum of the options.

// lines: [{ product: id, variant?: id, quantity, name }]
async function takeStock(lines, session = null) {
  const taken = [];
  for (const line of lines) {
    const result = line.variant
      ? await Product.updateOne(
          {
            _id: line.product,
            ...LISTED_PRODUCT,
            variants: {
              $elemMatch: {_id: line.variant, stock: {$gte: line.quantity}},
            },
          },
          {$inc: {'variants.$.stock': -line.quantity, stock: -line.quantity}},
          {session},
        )
      : await Product.updateOne(
          {_id: line.product, ...LISTED_PRODUCT, stock: {$gte: line.quantity}},
          {$inc: {stock: -line.quantity}},
          {session},
        );
    if (result.modifiedCount !== 1) {
      if (!session) await returnStock(taken);
      const left = await Product.findById(line.product)
        .select('stock variants')
        .session(session)
        .lean();
      const option =
        line.variant && left
          ? (left.variants || []).find(
              (v) => String(v._id) === String(line.variant),
            )
          : null;
      const stock = line.variant
        ? option
          ? option.stock
          : 0
        : left
          ? left.stock
          : 0;
      throw new HttpError(
        409,
        stock > 0
          ? `Only ${stock} of ${line.name} left now. Please update your cart.`
          : `${line.name} just sold out. Please remove it from your cart.`,
        null,
        'items_unavailable',
      );
    }
    taken.push(line);
  }
  return taken;
}

// Puts stock back (cancelled or returned items, or an order that could not be saved). An option that
// has since been deleted from the product cannot take stock back: then nothing changes, so the
// product's total still equals the sum of its options.
async function returnStock(lines, session = null) {
  for (const line of lines) {
    if (line.variant) {
      await Product.updateOne(
        {_id: line.product, 'variants._id': line.variant},
        {$inc: {'variants.$.stock': line.quantity, stock: line.quantity}},
        {session},
      );
    } else {
      await Product.updateOne(
        {_id: line.product},
        {$inc: {stock: line.quantity}},
        {session},
      );
    }
  }
}

// Takes the stock, then runs work(session, undo). If work fails, the stock is given back:
// by the transaction rolling back, or by the undo step on a single server.
async function withStock(lines, work) {
  return inTransaction(async (session, undo) => {
    await takeStock(lines, session);
    undo(() => returnStock(lines));
    return work(session, undo);
  });
}

function receiptFor(key, line) {
  return require('crypto')
    .createHash('sha256')
    .update(`${key}:${line.product}:${line.variant || ''}`)
    .digest('hex');
}

// The movement and its receipt are one product update. Journals can retry a
// partially completed order after a crash, even on standalone MongoDB.
async function moveOnce(lines, key, direction, reservedBy = null) {
  for (const line of lines) {
    const receipt = receiptFor(key, line);
    const filter = {_id: line.product, stockReceipts: {$ne: receipt}};
    if (reservedBy)
      filter.$and = [{stockReceipts: receiptFor(reservedBy, line)}];
    if (direction < 0) Object.assign(filter, LISTED_PRODUCT);
    if (line.variant) {
      filter.variants = {
        $elemMatch: {
          _id: line.variant,
          ...(direction < 0 ? {stock: {$gte: line.quantity}} : {}),
        },
      };
    } else if (direction < 0) filter.stock = {$gte: line.quantity};
    const change = {stock: direction * line.quantity};
    if (line.variant) change['variants.$.stock'] = direction * line.quantity;
    const result = await Product.updateOne(filter, {
      $inc: change,
      $addToSet: {stockReceipts: receipt},
    });
    if (result.modifiedCount || direction > 0) continue;
    const applied = await Product.exists({
      _id: line.product,
      stockReceipts: receipt,
    });
    if (!applied)
      throw new HttpError(
        409,
        `${line.name || 'This product'} is no longer available in that quantity.`,
        null,
        'items_unavailable',
      );
  }
}
const takeStockOnce = (lines, key) => moveOnce(lines, key, -1);
const returnStockOnce = (lines, key, reservedBy = null) =>
  moveOnce(lines, key, 1, reservedBy);

module.exports = {
  supportsTransactions,
  takeStock,
  returnStock,
  withStock,
  takeStockOnce,
  returnStockOnce,
};
