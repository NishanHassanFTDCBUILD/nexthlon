const Product = require('../models/Product');
const {readProductOptions} = require('../utils/validators');
const {HttpError} = require('../utils/http');

function readCombination(body) {
  if (
    !body ||
    ['size', 'colour'].some(
      (key) => body[key] !== undefined && typeof body[key] !== 'string',
    )
  )
    throw new HttpError(400, 'Enter a size and colour as text.');
  const checked = readProductOptions([
    {size: body.size || '', colour: body.colour || '', stock: 0},
  ]);
  if (checked.error) throw new HttpError(400, checked.error);
  const {size, colour} = checked.list[0];
  return {size, colour};
}

// Runs in the same transaction as the stock addition and its permanent receipt.
async function ensureOption(productId, combination, session) {
  if (!require('mongoose').isValidObjectId(productId))
    throw new HttpError(404, 'Product not found.');
  const product = await Product.findById(productId).session(session);
  if (!product) throw new HttpError(404, 'Product not found.');
  const normalize = (value) =>
    String(value || '')
      .trim()
      .toLowerCase();
  const options = product.variants || [];
  const existing = options.find(
    (option) =>
      normalize(option.size) === normalize(combination.size) &&
      normalize(option.colour) === normalize(combination.colour),
  );
  if (existing) return {id: String(existing._id), created: false};
  if (!options.length && product.stock > 0)
    throw new HttpError(
      409,
      'This product has unassigned stock. In Edit product, assign those units to their actual size and colour first. Then add combinations here.',
    );
  // Reuse existing spelling so the storefront has one Black/black colour choice.
  const canonical = (key, value) =>
    options.find((option) => normalize(option[key]) === normalize(value))?.[
      key
    ] || value;
  const added = {
    size: canonical('size', combination.size),
    colour: canonical('colour', combination.colour),
    stock: 0,
  };
  const checked = readProductOptions([
    ...options.map((option) => ({
      size: option.size,
      colour: option.colour,
      stock: option.stock,
      sku: option.sku,
    })),
    added,
  ]);
  if (checked.error) throw new HttpError(400, checked.error);
  product.variants.push(added);
  await product.save({session});
  return {
    id: String(product.variants[product.variants.length - 1]._id),
    created: true,
  };
}

module.exports = {readCombination, ensureOption};
