const mongoose = require("mongoose");
const Product = require("../models/Product");
const Category = require("../models/Category");
const { LOW_STOCK_LIMIT } = require("../config/catalog");
const { paiseToRupees } = require("../utils/money");
const { HttpError } = require("../utils/http");
const { slugify } = require("../utils/slug");
const { escapeRegex, toPositiveInt } = require("./productService");
const imageService = require("./imageService");

const PAGE_SIZE = 10;
const STATUSES = ["all", "active", "low", "unlisted", "out"];
const ADMIN_SORTS = {
  newest: { label: "Newest first", order: { createdAt: -1, _id: -1 } },
  oldest: { label: "Oldest first", order: { createdAt: 1, _id: 1 } },
  name_asc: { label: "Name: A to Z", order: { name: 1, _id: 1 } },
  price_asc: { label: "Price: low to high", order: { price: 1, _id: 1 } },
  price_desc: { label: "Price: high to low", order: { price: -1, _id: 1 } },
  stock_asc: { label: "Stock: lowest first", order: { stock: 1, name: 1 } }
};

function statusOf(product) {
  if (!product.isListed) return "unlisted";
  return product.stock > 0 ? "active" : "out";
}

// Every photo of a product, main one first, with no repeats.
function imagesOf(product) {
  return [...new Set([product.image, ...(product.gallery || [])].filter(Boolean))];
}

// Money stays in paise here; the *Rupees copies fill the admin form, which works in rupees.
function toAdminProduct(product) {
  const category = product.category && product.category.name ? product.category : null;
  return {
    id: String(product._id),
    name: product.name,
    slug: product.slug,
    category: category ? String(category._id) : String(product.category || ""),
    categoryName: category ? category.name : "",
    brand: product.brand,
    description: product.description || "",
    basePrice: product.basePrice,
    price: product.price,
    mrp: product.mrp,
    basePriceRupees: paiseToRupees(product.basePrice),
    mrpRupees: paiseToRupees(product.mrp),
    offerPercent: product.offerPercent || 0,
    bestOffer: product.bestOffer || 0,
    discountPercent: product.discountPercent,
    stock: product.stock,
    isListed: product.isListed !== false,
    isLowStock: product.stock > 0 && product.stock <= LOW_STOCK_LIMIT,
    status: statusOf(product),
    image: product.image,
    images: imagesOf(product),
    createdAt: product.createdAt,
    updatedAt: product.updatedAt
  };
}

function readAdminFilters(query = {}) {
  return {
    q: typeof query.q === "string" ? query.q.trim().slice(0, 80) : "",
    category: typeof query.category === "string" && mongoose.isValidObjectId(query.category) ? query.category : "",
    status: STATUSES.includes(query.status) ? query.status : "all",
    sort: Object.hasOwn(ADMIN_SORTS, query.sort) ? query.sort : "newest",
    page: toPositiveInt(query.page, 1)
  };
}

async function listAdminProducts(query) {
  const filters = readAdminFilters(query);
  const filter = {};
  if (filters.q) filter.name = new RegExp(escapeRegex(filters.q), "i");
  if (filters.category) filter.category = filters.category;
  if (filters.status === "unlisted") filter.isListed = false;
  if (filters.status === "active") Object.assign(filter, { isListed: true, stock: { $gt: 0 } });
  if (filters.status === "out") Object.assign(filter, { isListed: true, stock: 0 });
  if (filters.status === "low") Object.assign(filter, { isListed: true, stock: { $gt: 0, $lte: LOW_STOCK_LIMIT } });

  const [products, total] = await Promise.all([
    Product.find(filter)
      .sort(ADMIN_SORTS[filters.sort].order)
      .skip((filters.page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .populate("category", "name")
      .lean(),
    Product.countDocuments(filter)
  ]);

  return {
    products: products.map(toAdminProduct),
    filters,
    pagination: { page: filters.page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), total, limit: PAGE_SIZE }
  };
}

async function findProduct(productId) {
  if (!mongoose.isValidObjectId(productId)) throw new HttpError(404, "Product not found.");
  const product = await Product.findById(productId).populate("category", "name offerPercent isListed");
  if (!product) throw new HttpError(404, "Product not found.");
  return product;
}

// The chosen category must exist. Its offer and visibility are copied onto the product.
async function checkCategory(value, errors) {
  if (errors.category) return null;
  const category = await Category.findById(value.category).lean();
  if (!category) errors.category = "Choose a category.";
  return category;
}

async function getAdminProduct(productId) {
  return toAdminProduct(await findProduct(productId));
}

function readJsonList(value) {
  if (value === undefined || value === "") return [];
  try {
    const list = JSON.parse(value);
    return Array.isArray(list) ? list : null;
  } catch {
    return null;
  }
}

// Decides which photos the product ends up with. Pure, so it is easy to test.
//   current:  the product's photos now (empty for a new product)
//   keepRaw:  JSON list of current photos to keep, in order
//   mainRaw:  the main photo: a kept URL, or "new:<n>" for the n-th uploaded file
//   newCount: how many files were uploaded
// Returns { error } or { keep, removed, main } where main is { kind: "kept"|"new", value }.
function planImages({ current = [], keepRaw, mainRaw, newCount = 0 }) {
  const list = readJsonList(keepRaw);
  if (list === null) return { error: "The photo list could not be read. Reload the page and try again." };
  const keep = [...new Set(list)].filter(url => current.includes(url));
  if (keep.length !== list.length) return { error: "Some photos no longer belong to this product. Reload the page." };

  const total = keep.length + newCount;
  if (total === 0) return { error: "Add at least one photo." };
  if (total > imageService.MAX_IMAGES) return { error: `A product can have up to ${imageService.MAX_IMAGES} photos.` };

  let main = keep.length ? { kind: "kept", value: keep[0] } : { kind: "new", value: 0 };
  const mainText = typeof mainRaw === "string" ? mainRaw : "";
  const newMatch = /^new:(\d)$/.exec(mainText);
  if (newMatch && Number(newMatch[1]) < newCount) main = { kind: "new", value: Number(newMatch[1]) };
  else if (keep.includes(mainText)) main = { kind: "kept", value: mainText };

  return { keep, removed: current.filter(url => !keep.includes(url)), main };
}

// Turns a plan plus the saved upload URLs into the final photo list, main photo first.
function orderImages(plan, newUrls) {
  const all = [...plan.keep, ...newUrls];
  const mainUrl = plan.main.kind === "kept" ? plan.main.value : newUrls[plan.main.value];
  return [mainUrl, ...all.filter(url => url !== mainUrl)];
}

// Makes "trail-shoe", or "trail-shoe-2", "trail-shoe-3"… if the name is already taken.
async function uniqueSlug(name, exceptId) {
  const base = slugify(name);
  for (let n = 1; n < 1000; n += 1) {
    const slug = n === 1 ? base : `${base}-${n}`;
    const taken = await Product.exists(exceptId ? { slug, _id: { $ne: exceptId } } : { slug });
    if (!taken) return slug;
  }
  return `${base}-${Date.now().toString(36)}`;
}

function checkUploads(files, errors) {
  const fakes = imageService.findFakeImages(files);
  if (fakes.length) errors.images = `${fakes[0]} is not a real JPG, PNG or WEBP image.`;
}

// Saves the product. New photos are written to disk only after every check has passed,
// and they are removed again if the database save fails.
async function persist(product, value, plan, files, category) {
  const newUrls = await imageService.saveImages(files);
  try {
    const images = orderImages(plan, newUrls);
    Object.assign(product, value, {
      category: category._id,
      categoryOffer: category.offerPercent || 0,
      categoryListed: category.isListed !== false,
      image: images[0],
      gallery: images
    });
    if (product.isNew || product.isModified("name")) product.slug = await uniqueSlug(value.name, product._id);
    try {
      await product.save();
    } catch (error) {
      // Two admins saved the same name at the same moment: try once more with a fresh slug.
      if (error.code !== 11000) throw error;
      product.slug = await uniqueSlug(value.name, product._id);
      await product.save();
    }
  } catch (error) {
    await imageService.deleteImages(newUrls);
    throw error;
  }
  await imageService.deleteImages(plan.removed);
  await product.populate("category", "name");
  return toAdminProduct(product);
}

async function createProduct({ value, errors, body, files }) {
  const plan = planImages({ current: [], keepRaw: "[]", mainRaw: body.mainImage, newCount: files.length });
  if (plan.error) errors.images = plan.error;
  checkUploads(files, errors);
  const category = await checkCategory(value, errors);
  if (Object.keys(errors).length) throw new HttpError(400, "Please fix the highlighted fields.", errors);
  return persist(new Product(), value, plan, files, category);
}

async function updateProduct(productId, { value, errors, body, files }) {
  const product = await findProduct(productId);
  const plan = planImages({ current: imagesOf(product), keepRaw: body.keepImages, mainRaw: body.mainImage, newCount: files.length });
  if (plan.error) errors.images = plan.error;
  checkUploads(files, errors);
  const category = await checkCategory(value, errors);
  if (Object.keys(errors).length) throw new HttpError(400, "Please fix the highlighted fields.", errors);
  return persist(product, value, plan, files, category);
}

// Unlisting hides a product from shoppers without deleting it, so it can be listed again later.
async function setListed(productId, isListed) {
  const product = await findProduct(productId);
  product.isListed = isListed;
  await product.save();
  return toAdminProduct(product);
}

// Restock: adds units in one atomic update (no read-then-write race with checkout).
// Returns the stock before and after, for the audit log.
const MAX_STOCK = 100000;
async function restock(productId, add) {
  if (!mongoose.isValidObjectId(productId)) throw new HttpError(404, "Product not found.");
  const product = await Product.findOneAndUpdate(
    { _id: productId, stock: { $lte: MAX_STOCK - add } },
    { $inc: { stock: add } },
    { new: true }
  );
  if (!product) {
    if (await Product.exists({ _id: productId })) throw new HttpError(400, `Stock can't go above ${MAX_STOCK.toLocaleString("en-IN")}.`);
    throw new HttpError(404, "Product not found.");
  }
  return { product: toAdminProduct(product), before: product.stock - add, after: product.stock };
}

module.exports = {
  restock,
  PAGE_SIZE,
  ADMIN_SORTS,
  STATUSES,
  readAdminFilters,
  listAdminProducts,
  getAdminProduct,
  planImages,
  orderImages,
  uniqueSlug,
  createProduct,
  updateProduct,
  setListed,
  toAdminProduct
};
