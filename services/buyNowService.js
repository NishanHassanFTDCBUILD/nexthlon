const mongoose = require('mongoose');
const BuyNow = require('../models/BuyNow');
const Product = require('../models/Product');
const cartService = require('./cartService');
const {HttpError} = require('../utils/http');
const {LISTED_PRODUCT} = require('../utils/queryFilters');
const {hasOptions, readOptionId} = require('../utils/options');

// How long a Buy now checkout stays open before it has to be started again.
const TTL_MS = 30 * 60 * 1000;

// Where an order's items come from: the cart, or a single Buy now product.
const SOURCES = ['cart', 'buynow'];
function readSource(value) {
  return value === 'buynow' ? 'buynow' : 'cart';
}

const EXPIRED_MESSAGE =
  'Your Buy now checkout has expired. Open the product and click Buy now again.';

// Saves (or replaces) the customer's Buy now product (and its size, when it has sizes). Same quantity
// rules as the cart.
async function start(userId, productId, rawQuantity, rawVariantId = null) {
  if (!mongoose.isValidObjectId(productId))
    throw new HttpError(404, 'Product not found.');
  const product = await Product.findOne({
    _id: productId,
    ...LISTED_PRODUCT,
  }).lean();
  if (!product) throw new HttpError(404, 'Product not found.');
  const quantity = Number(rawQuantity);
  const variantId = readOptionId(rawVariantId);
  if (hasOptions(product) && !variantId)
    throw new HttpError(400, 'Choose a size first.', null, 'option_required');
  const problem = cartService.quantityProblem(product, quantity, variantId);
  if (problem) throw new HttpError(400, problem, {quantity: problem});
  await BuyNow.findOneAndUpdate(
    {user: userId},
    {
      $set: {
        product: product._id,
        variant: variantId,
        quantity,
        couponCode: '',
        expiresAt: new Date(Date.now() + TTL_MS),
      },
    },
    {upsert: true, new: true, setDefaultsOnInsert: true},
  );
  return {product, quantity};
}

// The Buy now product in the same shape as cartService.getCart(), so checkout can use either.
// Null when there is none (never started, already bought, or expired).
async function getView(userId) {
  const doc = await BuyNow.findOne({user: userId, expiresAt: {$gt: new Date()}})
    .populate('product')
    .lean();
  if (!doc || !doc.product) return null;
  return {
    ...cartService.buildCartView([
      {
        product: doc.product,
        variant: doc.variant || null,
        quantity: doc.quantity,
      },
    ]),
    couponCode: doc.couponCode || '',
  };
}

async function setCoupon(userId, code) {
  await BuyNow.updateOne({user: userId}, {$set: {couponCode: code}});
}

// Called once the Buy now order is placed or paid.
async function clear(userId, session) {
  await BuyNow.deleteOne({user: userId}, session ? {session} : undefined);
}

module.exports = {
  TTL_MS,
  SOURCES,
  EXPIRED_MESSAGE,
  readSource,
  start,
  getView,
  setCoupon,
  clear,
};
