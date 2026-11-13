const mongoose = require("mongoose");
const Product = require("../models/Product");
const Category = require("../models/Category");
const { LOW_STOCK_LIMIT } = require("../config/catalog");
const { paiseToRupees } = require("../utils/money");
const { HttpError } = require("../utils/http");
const { slugify } = require("../utils/slug");
const { suggestTax } = require("../utils/gst");
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
    options: (product.variants || []).map(v => ({ id: String(v._id), size: v.size || "", colour: v.colour || "", sku: v.sku || "", stock: v.stock })),
    hasOptions: Boolean(product.variants && product.variants.length),
    isListed: product.isListed !== false,
    isLowStock: product.stock > 0 && product.stock <= LOW_STOCK_LIMIT,
    status: statusOf(product),
    image: product.image,
    images: imagesOf(product),
    colourPhotos: (product.colourPhotos || []).map(row => ({ image: row.image, colour: row.colour })),
    // GST as saved (empty when the suggested rate is used), plus the suggestion, for the form.
    tax: {
      hsn: (product.tax && product.tax.hsn) || "",
      rate: product.tax && Number.isInteger(product.tax.rate) ? product.tax.rate : null,
      rateAbove: product.tax && Number.isInteger(product.tax.rateAbove) ? product.tax.rateAbove : null,
      aboveRupees: product.tax && Number.isInteger(product.tax.above) ? paiseToRupees(product.tax.above) : ""
    },
    taxSuggestion: suggestTax(product.name, category ? category.name : ""),
    countryOfOrigin: product.countryOfOrigin || "India",
    manufacturer: product.manufacturer || "",
    netQuantity: product.netQuantity || "",
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
// orderRaw (optional) is the order the admin sees on screen: each entry is a kept photo's address or
// "new:<n>" for the n-th upload. It keeps an edited photo (sent again as a new upload) in its place.
function planImages({ current = [], keepRaw, mainRaw, orderRaw, newCount = 0 }) {
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

  const order = readJsonList(orderRaw);
  if (order === null) return { error: "The photo order could not be read. Reload the page and try again." };
  if (order.length) {
    const expected = [...keep, ...Array.from({ length: newCount }, (_, i) => `new:${i}`)];
    const sameSet = order.length === expected.length && new Set(order).size === order.length &&
      order.every(entry => expected.includes(entry));
    if (!sameSet) return { error: "The photo order could not be read. Reload the page and try again." };
  }

  return { keep, removed: current.filter(url => !keep.includes(url)), main, order };
}

// The colour of each photo, in the order the admin sees them (the same order as imageOrder: kept
// photos, then new uploads). Sent as JSON: ["Black", "", "Volt"]. "" is a photo for every colour.
// Returns { error } or { colours } (null when the form did not send any, meaning "keep what is there").
function readPhotoColours(raw, count) {
  if (raw === undefined) return { colours: null };
  const list = readJsonList(raw);
  if (list === null || list.length !== count || !list.every(value => typeof value === "string" && value.trim().length <= 30)) {
    return { error: "The photo colours could not be read. Reload the page and try again." };
  }
  return { colours: list.map(value => value.trim()) };
}

// Pairs each final photo address with its colour. Only colours the product really has are kept.
function colourPhotosFor(plan, newUrls, colours, knownColours) {
  const fromToken = entry => (/^new:\d$/.test(entry) ? newUrls[Number(entry.slice(4))] : entry);
  const tokens = plan.order && plan.order.length ? plan.order : [...plan.keep, ...newUrls.map((_, i) => `new:${i}`)];
  const known = new Set(knownColours.map(colour => colour.toLowerCase()));
  const pairs = [];
  tokens.forEach((token, index) => {
    const colour = colours[index];
    const image = fromToken(token);
    if (colour && image && known.has(colour.toLowerCase())) {
      pairs.push({ image, colour: knownColours.find(name => name.toLowerCase() === colour.toLowerCase()) });
    }
  });
  return pairs;
}

// Turns a plan plus the saved upload URLs into the final photo list, main photo first.
function orderImages(plan, newUrls) {
  const fromToken = entry => (/^new:\d$/.test(entry) ? newUrls[Number(entry.slice(4))] : entry);
  const all = plan.order && plan.order.length ? plan.order.map(fromToken) : [...plan.keep, ...newUrls];
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
async function persist(product, value, plan, files, category, photoColours = null) {
  const newUrls = await imageService.saveImages(files);
  try {
    const images = orderImages(plan, newUrls);
    const fields = { ...value };
    if (value.variants) {
      // A row that was already saved keeps its id, so carts and orders that point at it still find it.
      const existing = new Set((product.variants || []).map(v => String(v._id)));
      fields.variants = value.variants.map(({ id, ...option }) => (id && existing.has(id) ? { _id: id, ...option } : option));
    }
    const colours = [...new Set((fields.variants || product.variants || []).map(v => v.colour).filter(Boolean))];
    if (photoColours) {
      fields.colourPhotos = colourPhotosFor(plan, newUrls, photoColours, colours);
    } else {
      // Not sent: keep the pairs whose photo and colour are both still there.
      const known = new Set(colours);
      fields.colourPhotos = (product.colourPhotos || [])
        .filter(row => images.includes(row.image) && known.has(row.colour))
        .map(row => ({ image: row.image, colour: row.colour }));
    }
    Object.assign(product, fields, {
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
  const plan = planImages({ current: [], keepRaw: "[]", mainRaw: body.mainImage, orderRaw: body.imageOrder, newCount: files.length });
  if (plan.error) errors.images = plan.error;
  const photoColours = plan.error ? { colours: null } : readPhotoColours(body.photoColours, plan.keep.length + files.length);
  if (photoColours.error) errors.images = photoColours.error;
  checkUploads(files, errors);
  const category = await checkCategory(value, errors);
  if (Object.keys(errors).length) throw new HttpError(400, "Please fix the highlighted fields.", errors);
  return persist(new Product(), value, plan, files, category, photoColours.colours);
}

async function updateProduct(productId, { value, errors, body, files }) {
  const product = await findProduct(productId);
  const plan = planImages({ current: imagesOf(product), keepRaw: body.keepImages, mainRaw: body.mainImage, orderRaw: body.imageOrder, newCount: files.length });
  if (plan.error) errors.images = plan.error;
  const photoColours = plan.error ? { colours: null } : readPhotoColours(body.photoColours, plan.keep.length + files.length);
  if (photoColours.error) errors.images = photoColours.error;
  checkUploads(files, errors);
  const category = await checkCategory(value, errors);
  if (Object.keys(errors).length) throw new HttpError(400, "Please fix the highlighted fields.", errors);
  return persist(product, value, plan, files, category, photoColours.colours);
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
  // A product with sizes keeps its stock per size; its total is changed on the edit page, size by size.
  if (await Product.exists({ _id: productId, "variants.0": { $exists: true } })) throw new HttpError(400, "This product has sizes or colours. Change each one's stock on the Inventory page.", null, "has_options");
  const product = await Product.findOneAndUpdate(
    { _id: productId, stock: { $lte: MAX_STOCK - add }, "variants.0": { $exists: false } },
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
  readPhotoColours,
  colourPhotosFor,
  uniqueSlug,
  createProduct,
  updateProduct,
  setListed,
  toAdminProduct
};
