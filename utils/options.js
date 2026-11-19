// Product options (sizes, colours): small helpers shared by the cart, checkout, orders and pages.
// A product with options keeps them in product.variants (models/Product.js); a cart or order line names
// the chosen one by its _id. Lines without one belong to products without options.
const mongoose = require('mongoose');

const hasOptions = (product) =>
  Boolean(
    product && Array.isArray(product.variants) && product.variants.length,
  );

// The option with this id, or null.
function findOption(product, optionId) {
  if (!hasOptions(product) || !optionId) return null;
  return (
    product.variants.find(
      (variant) => String(variant._id) === String(optionId),
    ) || null
  );
}

// "Size 9 · Red", "Size M", "Blue", or "" for no option.
function optionLabel(option) {
  if (!option) return '';
  return [option.size ? `Size ${option.size}` : '', option.colour || '']
    .filter(Boolean)
    .join(' · ');
}

// A cart line is one product, or one option of one product. Its key is used in cart URLs:
// "<productId>" or "<productId>-<optionId>".
const lineKey = (productId, optionId) =>
  optionId ? `${productId}-${optionId}` : String(productId);

// The product and option ids from a line key, or null when it is not one.
function readLineKey(key) {
  const match = /^([a-f0-9]{24})(?:-([a-f0-9]{24}))?$/i.exec(String(key || ''));
  if (!match) return null;
  return {productId: match[1], optionId: match[2] || null};
}

// An option id from a request (form or JSON), or null. Anything that is not an id is ignored.
const readOptionId = (value) =>
  typeof value === 'string' &&
  mongoose.isValidObjectId(value) &&
  /^[a-f0-9]{24}$/i.test(value)
    ? value
    : null;

// The sizes and colours a product comes in, in the order the admin entered them, without repeats.
function optionChoices(product) {
  const sizes = [];
  const colours = [];
  (product && product.variants ? product.variants : []).forEach((variant) => {
    if (variant.size && !sizes.includes(variant.size)) sizes.push(variant.size);
    if (variant.colour && !colours.includes(variant.colour))
      colours.push(variant.colour);
  });
  return {sizes, colours};
}

module.exports = {
  hasOptions,
  findOption,
  optionLabel,
  lineKey,
  readLineKey,
  readOptionId,
  optionChoices,
};
