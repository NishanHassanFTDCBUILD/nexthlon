const mongoose = require("mongoose");
const Cart = require("../models/Cart");
const GuestCart = require("../models/GuestCart");
const Product = require("../models/Product");
const { HttpError } = require("../utils/http");
const { STORE } = require("../config/store");
const { deliveryFeeFor } = require("../utils/pricing");
const { hasOptions, findOption, optionLabel, lineKey, readLineKey } = require("../utils/options");

const MAX_PER_PRODUCT = 5;

// Hidden products, and products in hidden categories, count as no longer sold.
function isSold(product) {
  return Boolean(product && product.isListed !== false && product.categoryListed !== false);
}

// The stock a line can draw on. A product with sizes or colours: the chosen option's stock (none when no
// option was chosen, or it was deleted). Without options: the product's. Called without an option id at
// all (undefined), it is the product as a whole (all its options together), for lists and wishlists.
function stockFor(product, optionId) {
  if (optionId === undefined || !hasOptions(product)) return product.stock;
  const option = findOption(product, optionId);
  return option ? option.stock : 0;
}

function isAvailable(product, optionId) {
  return isSold(product) && stockFor(product, optionId) > 0;
}

// The most of one product (or one size of it) a customer may hold: what is in stock, never more than 5.
function limitFor(product, optionId) {
  return Math.min(stockFor(product, optionId), MAX_PER_PRODUCT);
}

// Every quantity rule in one place. Returns a message for the shopper, or null if it is fine.
// optionId: the chosen size/colour (null when none was chosen).
function quantityProblem(product, quantity, optionId = null) {
  if (!isSold(product)) return "This product is no longer available.";
  if (hasOptions(product) && !optionId) return "Choose a size first.";
  if (hasOptions(product) && !findOption(product, optionId)) return "That size is no longer available. Please choose another.";
  const stock = stockFor(product, optionId);
  if (!(stock > 0)) return hasOptions(product) ? "That size is out of stock." : "This product is out of stock.";
  if (!Number.isInteger(quantity) || quantity < 1) return "Choose a quantity of at least 1.";
  if (quantity > MAX_PER_PRODUCT) return `You can buy up to ${MAX_PER_PRODUCT} of each product.`;
  if (quantity > stock) return `Only ${stock} left in stock.`;
  return null;
}

// Why a line cannot be bought right now, for the cart page.
function reasonFor(product, optionId) {
  if (!isSold(product)) return "No longer sold";
  if (hasOptions(product) && !findOption(product, optionId)) return "Choose a size again";
  return "Out of stock";
}

// Turns stored cart lines (with their products loaded) into what the pages and API show.
// Prices always come from the product in the database. Unavailable lines stay visible
// but are left out of every total. A line's key ("<product>" or "<product>-<option>") names it in URLs.
function buildCartView(lines = []) {
  const items = [];
  const summary = {
    count: 0, itemCount: 0, mrpTotal: 0, subtotal: 0, savings: 0,
    deliveryFee: 0, freeDeliveryGap: 0, grandTotal: 0, unavailableCount: 0
  };

  for (const line of lines) {
    const product = line.product;
    if (!product || !product._id) continue;
    const optionId = line.variant ? String(line.variant) : null;
    const option = findOption(product, optionId);
    const available = isAvailable(product, optionId);
    const quantity = available ? Math.min(line.quantity, limitFor(product, optionId)) : line.quantity;
    const item = {
      key: lineKey(product._id, optionId),
      productId: String(product._id),
      variantId: optionId,
      option: optionLabel(option),
      sku: option ? option.sku || "" : "",
      slug: product.slug,
      name: product.name,
      brand: product.brand,
      image: product.image,
      price: product.price,
      mrp: product.mrp,
      discountPercent: product.discountPercent || 0,
      stock: stockFor(product, optionId),
      quantity,
      maxQuantity: available ? limitFor(product, optionId) : 0,
      available,
      reason: available ? null : reasonFor(product, optionId),
      lineTotal: available ? product.price * quantity : 0,
      lineMrp: available ? Math.max(product.mrp, product.price) * quantity : 0
    };
    items.push(item);
    summary.count += quantity;
    if (available) {
      summary.itemCount += quantity;
      summary.subtotal += item.lineTotal;
      summary.mrpTotal += item.lineMrp;
    } else {
      summary.unavailableCount += 1;
    }
  }
  // Everything is in whole paise, so the sums are exact.
  summary.savings = summary.mrpTotal - summary.subtotal;
  summary.deliveryFee = deliveryFeeFor(summary.subtotal);
  // How much more to spend for free delivery (0 when it is already free).
  summary.freeDeliveryGap = summary.deliveryFee ? STORE.freeDeliveryMin - summary.subtotal : 0;
  summary.grandTotal = summary.subtotal + summary.deliveryFee;
  return { items, summary };
}

function toObjectId(productId) {
  if (!mongoose.isValidObjectId(productId)) throw new HttpError(404, "Product not found.");
  return new mongoose.Types.ObjectId(String(productId));
}

// Is this stored line the given product and option? (Older lines have no option field at all.)
const sameLine = (item, productId, optionId) =>
  String(item.product && item.product._id ? item.product._id : item.product) === String(productId)
  && String(item.variant || "") === String(optionId || "");

// Whose cart: a signed-in customer (their user id) or a guest ({ guest: <token hash> }, see
// middleware/guestCart.js). Every rule below is the same for both; only where the cart is kept differs.
function storeFor(owner) {
  if (owner && typeof owner === "object" && typeof owner.guest === "string") {
    return { Model: GuestCart, filter: { tokenHash: owner.guest } };
  }
  return { Model: Cart, filter: { user: owner } };
}

async function findOrCreateCart(owner) {
  const { Model, filter } = storeFor(owner);
  try {
    return await Model.findOneAndUpdate(filter, { $setOnInsert: { ...filter, items: [] } }, { upsert: true, new: true });
  } catch (error) {
    // Two first-time adds at the same moment: the other one created the cart.
    if (error.code === 11000) return Model.findOne(filter);
    throw error;
  }
}

// Loads the cart with live product data. Deleted products are dropped, and quantities above
// the current stock are lowered, so the stored cart always follows the rules.
// couponCode is the coupon chosen at checkout (checked again by checkoutService); guests have none.
// No owner (a guest who has not added anything yet): an empty cart.
async function getCart(owner) {
  if (!owner) return { ...buildCartView([]), couponCode: "" };
  const { Model, filter } = storeFor(owner);
  const cart = await Model.findOne(filter).populate("items.product");
  if (!cart) return { ...buildCartView([]), couponCode: "" };

  let changed = false;
  const kept = cart.items.filter(item => item.product);
  if (kept.length !== cart.items.length) changed = true;
  for (const item of kept) {
    const optionId = item.variant ? String(item.variant) : null;
    if (isAvailable(item.product, optionId) && item.quantity > limitFor(item.product, optionId)) {
      item.quantity = limitFor(item.product, optionId);
      changed = true;
    }
  }
  if (changed) {
    cart.items = kept;
    await cart.save();
  }
  return { ...buildCartView(cart.items), couponCode: cart.couponCode || "" };
}

// The number shown on the header cart icon.
async function countItems(owner) {
  if (!owner) return 0;
  const { Model, filter } = storeFor(owner);
  const cart = await Model.findOne(filter).select("items.quantity").lean();
  return cart ? cart.items.reduce((sum, item) => sum + item.quantity, 0) : 0;
}

// How many of one product are already in the cart, all sizes together (the product page says
// "2 already in your cart").
async function quantityInCart(owner, productId) {
  if (!owner || !mongoose.isValidObjectId(productId)) return 0;
  const { Model, filter } = storeFor(owner);
  const cart = await Model.findOne(filter).select("items").lean();
  if (!cart) return 0;
  return cart.items.filter(item => String(item.product) === String(productId)).reduce((sum, item) => sum + item.quantity, 0);
}

// Adds a product (for a product with sizes or colours, one option of it), or raises the quantity if it is
// already in the cart. Size 8 and size 9 of the same shoe are separate lines.
async function addItem(owner, productId, quantity, optionId = null) {
  const id = toObjectId(productId);
  const product = await Product.findById(id).lean();
  // A product with sizes needs one chosen first. The page asks for it; anything else (a quick-add button,
  // a wishlist "move to cart") gets a reason code it can act on: show the product page.
  if (product && isSold(product) && hasOptions(product) && !optionId) {
    throw new HttpError(400, "Choose a size first.", null, "option_required");
  }
  const cart = await findOrCreateCart(owner);
  const existing = cart.items.find(item => sameLine(item, id, optionId));
  const already = existing ? existing.quantity : 0;

  const problem = quantityProblem(product, already + quantity, optionId);
  if (problem) {
    if (already && isAvailable(product, optionId)) {
      const room = limitFor(product, optionId) - already;
      // Not a failure from the shopper's side: the page shows these calmly ("Max in cart"), not as errors.
      throw room > 0
        ? new HttpError(400, `You already have ${already} in your cart. You can add ${room} more.`, null, "cart_room")
        : new HttpError(400, `You already have the most you can buy (${already}) in your cart.`, null, "cart_limit");
    }
    throw new HttpError(400, problem, null, product && isSold(product) && !(stockFor(product, optionId) > 0) ? "out_of_stock" : undefined);
  }

  if (existing) existing.quantity = already + quantity;
  else cart.items.push({ product: id, variant: optionId ? toObjectId(optionId) : null, quantity });
  await cart.save();
  return { product, option: findOption(product, optionId), cart: await getCart(owner) };
}

// key: the line's key from the cart ("<product>" or "<product>-<option>").
async function updateQuantity(owner, key, quantity) {
  const line = readLineKey(key);
  if (!line) throw new HttpError(404, "This item is not in your cart.");
  const { Model, filter } = storeFor(owner);
  const cart = owner ? await Model.findOne(filter) : null;
  const item = cart && cart.items.find(stored => sameLine(stored, line.productId, line.optionId));
  if (!item) throw new HttpError(404, "This item is not in your cart.");
  const product = await Product.findById(line.productId).lean();
  const problem = quantityProblem(product, quantity, line.optionId);
  if (problem) throw new HttpError(400, problem);
  item.quantity = quantity;
  await cart.save();
  return getCart(owner);
}

async function removeItem(owner, key) {
  const line = readLineKey(key);
  if (!owner || !line) throw new HttpError(404, "This item is not in your cart.");
  const { Model, filter } = storeFor(owner);
  // variant: null also matches older lines that have no option field.
  const target = { product: toObjectId(line.productId), variant: line.optionId ? toObjectId(line.optionId) : null };
  const result = await Model.updateOne({ ...filter, items: { $elemMatch: target } }, { $pull: { items: target } });
  if (!result.modifiedCount) throw new HttpError(404, "This item is not in your cart.");
  return getCart(owner);
}

async function clearCart(owner) {
  if (owner) {
    const { Model, filter } = storeFor(owner);
    await Model.updateOne(filter, { $set: Model === Cart ? { items: [], couponCode: "" } : { items: [] } });
  }
  return buildCartView([]);
}

// At sign-in or sign-up, everything the guest added moves into the account's cart. The same product and
// size already in both is added together, but never above the usual limit (stock, and 5 of each);
// products or sizes no longer sold are left out. The guest cart is then deleted. Returns how many units
// were added.
async function mergeGuestCart(userId, tokenHash) {
  if (!tokenHash) return { moved: 0 };
  const guest = await GuestCart.findOne({ tokenHash }).populate("items.product");
  if (!guest) return { moved: 0 };
  let moved = 0;
  const lines = guest.items.filter(line => line.product && isAvailable(line.product, line.variant ? String(line.variant) : null));
  if (lines.length) {
    const cart = await findOrCreateCart(userId);
    for (const line of lines) {
      const product = line.product;
      const optionId = line.variant ? String(line.variant) : null;
      const existing = cart.items.find(item => sameLine(item, product._id, optionId));
      const have = existing ? existing.quantity : 0;
      const next = Math.min(limitFor(product, optionId), have + line.quantity);
      if (next <= have) continue;
      moved += next - have;
      if (existing) existing.quantity = next;
      else cart.items.push({ product: product._id, variant: line.variant || null, quantity: next });
    }
    if (moved) await cart.save();
  }
  await GuestCart.deleteOne({ _id: guest._id });
  return { moved };
}

module.exports = {
  MAX_PER_PRODUCT,
  deliveryFeeFor,
  isSold,
  isAvailable,
  limitFor,
  stockFor,
  quantityProblem,
  buildCartView,
  getCart,
  countItems,
  quantityInCart,
  mergeGuestCart,
  addItem,
  updateQuantity,
  removeItem,
  clearCart
};
