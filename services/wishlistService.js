const mongoose = require("mongoose");
const Wishlist = require("../models/Wishlist");
const Product = require("../models/Product");
const cartService = require("./cartService");
const { HttpError } = require("../utils/http");
const { LISTED_PRODUCT } = require("../utils/queryFilters");
const { readLineKey } = require("../utils/options");

const MAX_ITEMS = 100;

function toObjectId(productId) {
  if (!mongoose.isValidObjectId(productId)) throw new HttpError(404, "Product not found.");
  return new mongoose.Types.ObjectId(String(productId));
}

// What the page and API show for each saved product. Prices are live; hidden products stay
// on the list, marked unavailable, so the customer knows what happened to them.
function toWishItem(product) {
  const sold = product.isListed !== false && product.categoryListed !== false;
  return {
    productId: String(product._id),
    slug: product.slug,
    name: product.name,
    brand: product.brand,
    image: product.image,
    price: product.price,
    mrp: product.mrp,
    discountPercent: product.discountPercent || 0,
    stock: product.stock,
    ratingAverage: product.ratingAverage || 0,
    ratingCount: product.ratingCount || 0,
    available: sold && product.stock > 0,
    reason: !sold ? "No longer sold" : product.stock > 0 ? null : "Out of stock"
  };
}

async function getWishlist(userId) {
  const list = await Wishlist.findOne({ user: userId }).populate("products").lean();
  const items = list ? list.products.filter(Boolean).map(toWishItem) : [];
  return { items, count: items.length };
}

// Just the saved product ids, for the hearts and the header badge on every page.
async function productIds(userId) {
  const list = await Wishlist.findOne({ user: userId }).select("products").lean();
  return list ? list.products.map(String) : [];
}

async function countItems(userId) {
  return (await productIds(userId)).length;
}

// Saving twice is fine: the product just moves to the top of the list.
async function addProduct(userId, productId) {
  const id = toObjectId(productId);
  const product = await Product.findOne({ _id: id, ...LISTED_PRODUCT }).select("name").lean();
  if (!product) throw new HttpError(404, "This product is no longer available.");
  await Wishlist.updateOne({ user: userId }, { $pull: { products: id } });
  await Wishlist.updateOne(
    { user: userId },
    { $push: { products: { $each: [id], $position: 0, $slice: MAX_ITEMS } } },
    { upsert: true }
  );
  return { product, wishlist: await getWishlist(userId) };
}

async function removeProduct(userId, productId) {
  const id = toObjectId(productId);
  const result = await Wishlist.updateOne({ user: userId, products: id }, { $pull: { products: id } });
  if (!result.modifiedCount) throw new HttpError(404, "This item is not in your wishlist.");
  return getWishlist(userId);
}

// Puts one of the product in the cart (all the cart rules apply), then takes it off the wishlist.
// If the cart says no (out of stock, limit reached), the wishlist is left as it was.
async function moveToCart(userId, productId) {
  const id = toObjectId(productId);
  const inList = await Wishlist.exists({ user: userId, products: id });
  if (!inList) throw new HttpError(404, "This item is not in your wishlist.");
  const { product, cart } = await cartService.addItem(userId, id, 1);
  await Wishlist.updateOne({ user: userId }, { $pull: { products: id } });
  return { product, cart, wishlist: await getWishlist(userId) };
}

// "Save for later": takes the line out of the cart and puts the product on the wishlist.
// key: the cart line ("<product>" or "<product>-<size>"); the wishlist keeps the product.
async function saveForLater(userId, key) {
  const line = readLineKey(key);
  if (!line) throw new HttpError(404, "This item is not in your cart.");
  const id = toObjectId(line.productId);
  const cart = await cartService.removeItem(userId, key);
  await Wishlist.updateOne({ user: userId }, { $pull: { products: id } });
  await Wishlist.updateOne(
    { user: userId },
    { $push: { products: { $each: [id], $position: 0, $slice: MAX_ITEMS } } },
    { upsert: true }
  );
  return { cart, wishlist: await getWishlist(userId) };
}

module.exports = { MAX_ITEMS, toWishItem, getWishlist, productIds, countItems, addProduct, removeProduct, moveToCart, saveForLater };
