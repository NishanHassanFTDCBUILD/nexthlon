const crypto = require("crypto");
const mongoose = require("mongoose");
const ShoppingList = require("../models/ShoppingList");
const Product = require("../models/Product");
const wishlistService = require("./wishlistService");
const cartService = require("./cartService");
const { HttpError } = require("../utils/http");
const { LISTED_PRODUCT } = require("../utils/queryFilters");

const MAX_LISTS = 10;
const MAX_ITEMS = 100;
const DEFAULT = "default"; // the customer's main wishlist, kept in the Wishlist model

function productObjectId(productId) {
  if (!mongoose.isValidObjectId(productId)) throw new HttpError(404, "Product not found.");
  return new mongoose.Types.ObjectId(String(productId));
}

// Every lookup includes the owner, so nobody can see or change someone else's list.
async function findOwnedList(userId, listId) {
  if (!mongoose.isValidObjectId(listId)) throw new HttpError(404, "List not found.");
  const list = await ShoppingList.findOne({ _id: listId, user: userId });
  if (!list) throw new HttpError(404, "List not found.");
  return list;
}

function summary(list, items) {
  return {
    id: String(list._id),
    name: list.name,
    isShared: Boolean(list.isShared && list.shareId),
    sharePath: list.isShared && list.shareId ? `/lists/${list.shareId}` : "",
    items,
    count: items.length
  };
}

// The default wishlist first, then the customer's own lists in the order they were made.
async function getLists(userId) {
  const [wishlist, lists] = await Promise.all([
    wishlistService.getWishlist(userId),
    ShoppingList.find({ user: userId }).sort({ createdAt: 1 }).populate("products").lean()
  ]);
  return {
    wishlist: { id: DEFAULT, name: "Wishlist", isShared: false, sharePath: "", items: wishlist.items, count: wishlist.count },
    lists: lists.map(list => summary(list, list.products.filter(Boolean).map(wishlistService.toWishItem)))
  };
}

async function getList(userId, listId) {
  const list = await findOwnedList(userId, listId);
  await list.populate("products");
  return summary(list, list.products.filter(Boolean).map(wishlistService.toWishItem));
}

async function createList(userId, { name }) {
  const count = await ShoppingList.countDocuments({ user: userId });
  if (count >= MAX_LISTS) throw new HttpError(400, `You can have up to ${MAX_LISTS} lists. Delete one to make another.`);
  await ensureUniqueName(userId, name);
  const list = await ShoppingList.create({ user: userId, name });
  return summary(list, []);
}

async function ensureUniqueName(userId, name, exceptId = null) {
  const pattern = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
  const filter = { user: userId, name: pattern };
  if (exceptId) filter._id = { $ne: exceptId };
  if (await ShoppingList.exists(filter)) throw new HttpError(409, "You already have a list with this name.", { name: "You already have a list with this name." });
}

async function renameList(userId, listId, { name }) {
  const list = await findOwnedList(userId, listId);
  await ensureUniqueName(userId, name, list._id);
  list.name = name;
  await list.save();
  return getList(userId, listId);
}

async function deleteList(userId, listId) {
  const list = await findOwnedList(userId, listId);
  await list.deleteOne();
}

// Adds a product (listed products only) to a list; adding again moves it to the top.
async function addItem(userId, listId, productId) {
  if (listId === DEFAULT) {
    await wishlistService.addProduct(userId, productId);
    return getLists(userId);
  }
  const id = productObjectId(productId);
  const list = await findOwnedList(userId, listId);
  const product = await Product.exists({ _id: id, ...LISTED_PRODUCT });
  if (!product) throw new HttpError(404, "This product is no longer available.");
  await ShoppingList.updateOne({ _id: list._id }, { $pull: { products: id } });
  await ShoppingList.updateOne({ _id: list._id }, { $push: { products: { $each: [id], $position: 0, $slice: MAX_ITEMS } } });
  return getLists(userId);
}

async function removeItem(userId, listId, productId) {
  if (listId === DEFAULT) {
    await wishlistService.removeProduct(userId, productId);
    return getLists(userId);
  }
  const id = productObjectId(productId);
  const list = await findOwnedList(userId, listId);
  const result = await ShoppingList.updateOne({ _id: list._id, products: id }, { $pull: { products: id } });
  if (!result.modifiedCount) throw new HttpError(404, "This item is not on that list.");
  return getLists(userId);
}

// Moves a product from one list to another (either can be the default wishlist).
async function moveItem(userId, { productId, from, to }) {
  if (from === to) throw new HttpError(400, "Choose a different list.");
  const id = productObjectId(productId);
  // Check the product is really on the source list before touching anything.
  if (from === DEFAULT) {
    const ids = await wishlistService.productIds(userId);
    if (!ids.includes(String(id))) throw new HttpError(404, "This item is not on that list.");
  } else {
    const source = await findOwnedList(userId, from);
    if (!source.products.some(p => String(p) === String(id))) throw new HttpError(404, "This item is not on that list.");
  }
  await addItem(userId, to, id);
  return removeItem(userId, from, id);
}

// Turns the read-only public link on or off. The random id is kept, so the link stays the same
// if sharing is turned on again.
async function setSharing(userId, listId, enabled) {
  const list = await findOwnedList(userId, listId);
  if (enabled && !list.shareId) list.shareId = crypto.randomBytes(12).toString("base64url");
  list.isShared = Boolean(enabled);
  await list.save();
  return getList(userId, listId);
}

// The public page for a shared list: its name and products, nothing about who owns it.
async function getShared(shareId) {
  if (typeof shareId !== "string" || !/^[A-Za-z0-9_-]{16}$/.test(shareId)) return null;
  const list = await ShoppingList.findOne({ shareId, isShared: true }).populate("products").lean();
  if (!list) return null;
  const items = list.products.filter(Boolean)
    .filter(product => product.isListed !== false && product.categoryListed !== false)
    .map(product => {
      const item = wishlistService.toWishItem(product);
      return { slug: item.slug, name: item.name, brand: item.brand, image: item.image, price: item.price, mrp: item.mrp, discountPercent: item.discountPercent, available: item.available };
    });
  return { name: list.name, items, count: items.length };
}

// One of the product goes to the cart (all the cart rules apply); then it leaves the list.
async function moveToCart(userId, listId, productId) {
  if (listId === DEFAULT) return wishlistService.moveToCart(userId, productId);
  const id = productObjectId(productId);
  const list = await findOwnedList(userId, listId);
  if (!list.products.some(p => String(p) === String(id))) throw new HttpError(404, "This item is not on that list.");
  const { product, cart } = await cartService.addItem(userId, id, 1);
  await ShoppingList.updateOne({ _id: list._id }, { $pull: { products: id } });
  return { product, cart };
}

module.exports = { MAX_LISTS, MAX_ITEMS, DEFAULT, getLists, getList, createList, renameList, deleteList, addItem, removeItem, moveItem, setSharing, getShared, moveToCart };
