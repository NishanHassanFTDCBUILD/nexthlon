const mongoose = require("mongoose");
const Cart = require("../models/Cart");
const Product = require("../models/Product");
const { HttpError } = require("../utils/http");
const { STORE } = require("../config/store");

const MAX_PER_PRODUCT = 5;

// Delivery is free from ₹499 (STORE.freeDeliveryMin); below that a flat fee applies. Paise.
function deliveryFeeFor(subtotal) {
  if (subtotal <= 0) return 0;
  return subtotal >= STORE.freeDeliveryMin ? 0 : STORE.deliveryFee;
}

// Hidden products, and products in hidden categories, count as no longer sold.
function isSold(product) {
  return Boolean(product && product.isListed !== false && product.categoryListed !== false);
}

function isAvailable(product) {
  return isSold(product) && product.stock > 0;
}

// The most of one product a customer may hold: what is in stock, and never more than 5.
function limitFor(product) {
  return Math.min(product.stock, MAX_PER_PRODUCT);
}

// Every quantity rule in one place. Returns a message for the shopper, or null if it is fine.
function quantityProblem(product, quantity) {
  if (!isSold(product)) return "This product is no longer available.";
  if (!(product.stock > 0)) return "This product is out of stock.";
  if (!Number.isInteger(quantity) || quantity < 1) return "Choose a quantity of at least 1.";
  if (quantity > MAX_PER_PRODUCT) return `You can buy up to ${MAX_PER_PRODUCT} of each product.`;
  if (quantity > product.stock) return `Only ${product.stock} left in stock.`;
  return null;
}

// Turns stored cart lines (with their products loaded) into what the pages and API show.
// Prices always come from the product in the database. Unavailable lines stay visible
// but are left out of every total.
function buildCartView(lines = []) {
  const items = [];
  const summary = {
    count: 0, itemCount: 0, mrpTotal: 0, subtotal: 0, savings: 0,
    deliveryFee: 0, freeDeliveryGap: 0, grandTotal: 0, unavailableCount: 0
  };

  for (const line of lines) {
    const product = line.product;
    if (!product || !product._id) continue;
    const available = isAvailable(product);
    const quantity = available ? Math.min(line.quantity, limitFor(product)) : line.quantity;
    const item = {
      productId: String(product._id),
      slug: product.slug,
      name: product.name,
      brand: product.brand,
      image: product.image,
      price: product.price,
      mrp: product.mrp,
      discountPercent: product.discountPercent || 0,
      stock: product.stock,
      quantity,
      maxQuantity: available ? limitFor(product) : 0,
      available,
      reason: available ? null : isSold(product) ? "Out of stock" : "No longer sold",
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

async function findOrCreateCart(userId) {
  try {
    return await Cart.findOneAndUpdate(
      { user: userId },
      { $setOnInsert: { user: userId, items: [] } },
      { upsert: true, new: true }
    );
  } catch (error) {
    // Two first-time adds at the same moment: the other one created the cart.
    if (error.code === 11000) return Cart.findOne({ user: userId });
    throw error;
  }
}

// Loads the cart with live product data. Deleted products are dropped, and quantities above
// the current stock are lowered, so the stored cart always follows the rules.
async function getCart(userId) {
  const cart = await Cart.findOne({ user: userId }).populate("items.product");
  if (!cart) return buildCartView([]);

  let changed = false;
  const kept = cart.items.filter(item => item.product);
  if (kept.length !== cart.items.length) changed = true;
  for (const item of kept) {
    if (isAvailable(item.product) && item.quantity > limitFor(item.product)) {
      item.quantity = limitFor(item.product);
      changed = true;
    }
  }
  if (changed) {
    cart.items = kept;
    await cart.save();
  }
  return buildCartView(cart.items);
}

// The number shown on the header cart icon.
async function countItems(userId) {
  const cart = await Cart.findOne({ user: userId }).select("items.quantity").lean();
  return cart ? cart.items.reduce((sum, item) => sum + item.quantity, 0) : 0;
}

// Adds a product, or raises the quantity if it is already in the cart.
async function addItem(userId, productId, quantity) {
  const id = toObjectId(productId);
  const product = await Product.findById(id).lean();
  const cart = await findOrCreateCart(userId);
  const existing = cart.items.find(item => item.product.equals(id));
  const already = existing ? existing.quantity : 0;

  const problem = quantityProblem(product, already + quantity);
  if (problem) {
    if (already && isAvailable(product)) {
      const room = limitFor(product) - already;
      throw new HttpError(400, room > 0
        ? `You already have ${already} in your cart. You can add ${room} more.`
        : `You already have the most you can buy (${already}) in your cart.`);
    }
    throw new HttpError(400, problem);
  }

  if (existing) existing.quantity = already + quantity;
  else cart.items.push({ product: id, quantity });
  await cart.save();
  return { product, cart: await getCart(userId) };
}

async function updateQuantity(userId, productId, quantity) {
  const id = toObjectId(productId);
  const cart = await Cart.findOne({ user: userId });
  const item = cart && cart.items.find(line => line.product.equals(id));
  if (!item) throw new HttpError(404, "This item is not in your cart.");
  const product = await Product.findById(id).lean();
  const problem = quantityProblem(product, quantity);
  if (problem) throw new HttpError(400, problem);
  item.quantity = quantity;
  await cart.save();
  return getCart(userId);
}

async function removeItem(userId, productId) {
  const id = toObjectId(productId);
  const result = await Cart.updateOne({ user: userId, "items.product": id }, { $pull: { items: { product: id } } });
  if (!result.modifiedCount) throw new HttpError(404, "This item is not in your cart.");
  return getCart(userId);
}

async function clearCart(userId) {
  await Cart.updateOne({ user: userId }, { $set: { items: [] } });
  return buildCartView([]);
}

module.exports = {
  MAX_PER_PRODUCT,
  deliveryFeeFor,
  isSold,
  isAvailable,
  limitFor,
  quantityProblem,
  buildCartView,
  getCart,
  countItems,
  addItem,
  updateQuantity,
  removeItem,
  clearCart
};
