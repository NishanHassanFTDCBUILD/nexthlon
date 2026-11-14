const mongoose = require("mongoose");
const Review = require("../models/Review");
const Product = require("../models/Product");
const { HttpError } = require("../utils/http");
const { LISTED_PRODUCT } = require("../utils/queryFilters");
const { VISIBLE_REVIEW } = require("../utils/queryFilters");

const PAGE_SIZE = 5;
// How many reviews one customer may post for the same product.
const MAX_PER_PRODUCT = 5;
const LIMIT_MESSAGE = `You can post up to ${MAX_PER_PRODUCT} reviews for this product.`;

// True when the customer has an order in which this product was delivered to them.
async function hasReceived(userId, productId) {
  const order = await mongoose.connection.collection("orders").findOne(
    { user: new mongoose.Types.ObjectId(String(userId)), items: { $elemMatch: { product: new mongoose.Types.ObjectId(String(productId)), status: "delivered" } } },
    { projection: { _id: 1 } }
  );
  return Boolean(order);
}

// Whether this visitor may review the product, and why not. user is the signed-in user or null.
async function reviewStatus(user, productId) {
  if (!user) return { canReview: false, reason: "signin" };
  if (user.role !== "customer") return { canReview: false, reason: "admin" };
  // Every customer may review, up to 5 times per product; buyers who received it get a
  // "Verified purchase" badge.
  const written = await Review.countDocuments({ product: productId, user: user._id });
  if (written >= MAX_PER_PRODUCT) return { canReview: false, reason: "limit", written, left: 0 };
  return { canReview: true, reason: null, written, left: MAX_PER_PRODUCT - written, verified: await hasReceived(user._id, productId) };
}

function publicReview(review) {
  return {
    id: String(review._id),
    author: review.authorName,
    rating: review.rating,
    title: review.title,
    body: review.body,
    createdAt: review.createdAt,
    verified: Boolean(review.verified),
    photos: review.photos || [],
    isHidden: Boolean(review.isHidden)
  };
}

// "Asha Nair" -> "Asha N."
function shortName(name) {
  const parts = String(name || "Customer").trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1].charAt(0).toUpperCase()}.` : parts[0];
}

// How many reviews gave each star rating, 5 down to 1. Hidden reviews are not counted.
async function ratingBreakdown(productId) {
  const groups = await Review.aggregate([
    { $match: { product: new mongoose.Types.ObjectId(String(productId)), isHidden: { $ne: true } } },
    { $group: { _id: "$rating", count: { $sum: 1 } } }
  ]);
  const counts = new Map(groups.map(group => [group._id, group.count]));
  return [5, 4, 3, 2, 1].map(stars => ({ stars, count: counts.get(stars) || 0 }));
}

// viewerId: the signed-in customer, if any. Their own reviews are marked "mine" so the product
// page can offer a Delete button on them (nobody else's id is ever sent).
async function listReviews(productId, page = 1, viewerId = null) {
  const [reviews, total, breakdown] = await Promise.all([
    Review.find({ product: productId, ...VISIBLE_REVIEW }).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).lean(),
    Review.countDocuments({ product: productId, ...VISIBLE_REVIEW }),
    ratingBreakdown(productId)
  ]);
  const viewer = viewerId ? String(viewerId) : null;
  return {
    reviews: reviews.map(review => ({ ...publicReview(review), mine: Boolean(viewer) && String(review.user) === viewer })),
    breakdown,
    pagination: { page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), total, limit: PAGE_SIZE }
  };
}

// The one review to feature on the product page: the best-rated (4 or 5 stars), verified buyers
// first, then the most detailed. Null when the product has no such review.
async function featuredReview(productId) {
  const [review] = await Review.find({ product: productId, rating: { $gte: 4 }, ...VISIBLE_REVIEW })
    .sort({ verified: -1, rating: -1, createdAt: -1 }).limit(20).lean()
    .then(rows => rows.sort((a, b) => (b.verified - a.verified) || (b.rating - a.rating) || (b.body.length - a.body.length)));
  return review ? publicReview(review) : null;
}

// Keeps the product's stored average (one decimal place) and count in step with its reviews.
// A review an admin has hidden counts for nothing, so hiding one changes the product's stars.
async function refreshProductRating(productId) {
  const [stats] = await Review.aggregate([
    { $match: { product: new mongoose.Types.ObjectId(String(productId)), isHidden: { $ne: true } } },
    { $group: { _id: null, average: { $avg: "$rating" }, count: { $sum: 1 } } }
  ]);
  const ratingAverage = stats ? Math.round(stats.average * 10) / 10 : 0;
  const ratingCount = stats ? stats.count : 0;
  await Product.updateOne({ _id: productId }, { $set: { ratingAverage, ratingCount } });
  return { average: ratingAverage, count: ratingCount };
}

async function addReview(user, productId, value, { savePhotos = null } = {}) {
  if (!mongoose.isValidObjectId(productId)) throw new HttpError(404, "Product not found.");
  const product = await Product.findOne({ _id: productId, ...LISTED_PRODUCT }).select("_id").lean();
  if (!product) throw new HttpError(404, "Product not found.");
  const status = await reviewStatus(user, product._id);
  if (status.reason === "limit") throw new HttpError(409, LIMIT_MESSAGE);
  if (!status.canReview) throw new HttpError(403, "Only customer accounts can review products.");
  const photos = savePhotos ? await savePhotos() : [];
  const review = await Review.create({ ...value, photos, product: product._id, user: user._id, authorName: shortName(user.name), verified: status.verified });
  // Two posts sent at the same moment could both pass the count above: keep only the first 5.
  if (await Review.countDocuments({ product: product._id, user: user._id }) > MAX_PER_PRODUCT) {
    await Review.deleteOne({ _id: review._id });
    throw new HttpError(409, LIMIT_MESSAGE);
  }
  const rating = await refreshProductRating(product._id);
  // The author just wrote it, so it is theirs: the product page shows Delete on it.
  return { review: { ...publicReview(review), mine: true }, rating };
}

// ---------- The customer's own reviews (My Account) ----------

// Reviews the customer wrote, newest first, with the product's name, link and photo.
async function listMine(userId) {
  const reviews = await Review.find({ user: userId }).sort({ createdAt: -1 }).limit(100).populate("product", "name slug image").lean();
  return reviews.filter(review => review.product).map(review => ({
    ...publicReview(review),
    product: { id: String(review.product._id), name: review.product.name, slug: review.product.slug, image: review.product.image }
  }));
}

// Products delivered to the customer that they have not reviewed yet (still sold), newest first.
async function waitingForReview(userId) {
  const id = new mongoose.Types.ObjectId(String(userId));
  const rows = await mongoose.connection.collection("orders").aggregate([
    { $match: { user: id } },
    { $unwind: "$items" },
    { $match: { "items.status": "delivered" } },
    { $sort: { deliveredAt: -1, createdAt: -1 } },
    { $group: { _id: "$items.product", deliveredAt: { $first: { $ifNull: ["$deliveredAt", "$createdAt"] } } } }
  ]).toArray();
  if (!rows.length) return [];
  const reviewed = new Set((await Review.find({ user: id }).select("product").lean()).map(review => String(review.product)));
  const pending = rows.filter(row => !reviewed.has(String(row._id)));
  const products = await Product.find({ _id: { $in: pending.map(row => row._id) }, ...LISTED_PRODUCT }).select("name slug image").lean();
  const byId = new Map(products.map(product => [String(product._id), product]));
  return pending
    .map(row => ({ product: byId.get(String(row._id)), deliveredAt: row.deliveredAt }))
    .filter(row => row.product)
    .map(row => ({ id: String(row.product._id), name: row.product.name, slug: row.product.slug, image: row.product.image, deliveredAt: row.deliveredAt }));
}

async function findOwnedReview(userId, reviewId) {
  if (!mongoose.isValidObjectId(reviewId)) throw new HttpError(404, "Review not found.");
  const review = await Review.findOne({ _id: reviewId, user: userId });
  if (!review) throw new HttpError(404, "Review not found.");
  return review;
}

async function updateMine(userId, reviewId, value) {
  const review = await findOwnedReview(userId, reviewId);
  Object.assign(review, value);
  await review.save();
  const rating = await refreshProductRating(review.product);
  return { review: publicReview(review), rating };
}

async function deleteMine(userId, reviewId) {
  const review = await findOwnedReview(userId, reviewId);
  await review.deleteOne();
  return refreshProductRating(review.product);
}

module.exports = { PAGE_SIZE, MAX_PER_PRODUCT, hasReceived, reviewStatus, listReviews, featuredReview, ratingBreakdown, refreshProductRating, addReview, shortName, publicReview, listMine, waitingForReview, updateMine, deleteMine };
