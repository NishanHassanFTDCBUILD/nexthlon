// Reviews, from the admin's side: find them, hide the ones that break the rules, delete the rest.
//
// Hiding is the normal action and is reversible: the review stays in the database (so the audit
// log still points at something real) but it leaves the product page and stops counting towards
// the product's stars. Deleting is for spam and cannot be undone.
const mongoose = require("mongoose");
const Review = require("../models/Review");
const Product = require("../models/Product");
const { HttpError } = require("../utils/http");
const { escapeRegex, toPositiveInt } = require("./productService");
const reviewService = require("./reviewService");

const PAGE_SIZE = 20;
const VISIBILITIES = ["all", "visible", "hidden"];
const VISIBILITY_LABELS = { all: "All", visible: "Visible", hidden: "Hidden" };
const SORTS = {
  newest: { label: "Newest first", order: { createdAt: -1, _id: -1 } },
  oldest: { label: "Oldest first", order: { createdAt: 1, _id: 1 } },
  rating_asc: { label: "Rating: low to high", order: { rating: 1, createdAt: -1 } },
  rating_desc: { label: "Rating: high to low", order: { rating: -1, createdAt: -1 } }
};

function readFilters(query = {}) {
  const rating = Number(query.rating);
  return {
    q: typeof query.q === "string" ? query.q.trim().slice(0, 80) : "",
    product: typeof query.product === "string" && mongoose.isValidObjectId(query.product) ? query.product : "",
    rating: Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : 0,
    visibility: VISIBILITIES.includes(query.visibility) ? query.visibility : "all",
    sort: Object.hasOwn(SORTS, query.sort) ? query.sort : "newest",
    page: toPositiveInt(query.page, 1)
  };
}

function filterFrom(filters) {
  const filter = {};
  if (filters.product) filter.product = filters.product;
  if (filters.rating) filter.rating = filters.rating;
  if (filters.visibility === "hidden") filter.isHidden = true;
  if (filters.visibility === "visible") filter.isHidden = { $ne: true };
  // Searches the words customers wrote and the short author name, never the customer's email.
  if (filters.q) {
    const pattern = new RegExp(escapeRegex(filters.q), "i");
    filter.$or = [{ body: pattern }, { title: pattern }, { authorName: pattern }];
  }
  return filter;
}

function toAdminReview(review) {
  return {
    id: String(review._id),
    rating: review.rating,
    title: review.title || "",
    body: review.body,
    author: review.authorName,
    isHidden: Boolean(review.isHidden),
    hiddenReason: review.hiddenReason || "",
    createdAt: review.createdAt,
    updatedAt: review.updatedAt,
    product: review.product && review.product.name
      ? { id: String(review.product._id), name: review.product.name, slug: review.product.slug }
      : null
  };
}

async function listReviews(query = {}) {
  const filters = readFilters(query);
  const filter = filterFrom(filters);
  const [rows, total, counts] = await Promise.all([
    Review.find(filter)
      .sort(SORTS[filters.sort].order)
      .skip((filters.page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .populate("product", "name slug")
      .lean(),
    Review.countDocuments(filter),
    // The counters above the table, over every review, not just this page.
    Review.aggregate([
      { $group: { _id: null, all: { $sum: 1 }, hidden: { $sum: { $cond: [{ $eq: ["$isHidden", true] }, 1, 0] } }, average: { $avg: "$rating" } } }
    ])
  ]);
  const summary = counts[0] || { all: 0, hidden: 0, average: 0 };
  return {
    reviews: rows.map(toAdminReview),
    filters,
    sorts: SORTS,
    visibilityLabels: VISIBILITY_LABELS,
    totals: {
      all: summary.all,
      hidden: summary.hidden,
      visible: summary.all - summary.hidden,
      average: Math.round((summary.average || 0) * 10) / 10
    },
    pagination: { page: filters.page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), total, limit: PAGE_SIZE }
  };
}

async function findReview(reviewId) {
  if (!mongoose.isValidObjectId(reviewId)) throw new HttpError(404, "Review not found.");
  const review = await Review.findById(reviewId).populate("product", "name slug");
  if (!review) throw new HttpError(404, "Review not found.");
  return review;
}

// Hiding or showing a review changes the product's stars, so the average is worked out again.
async function setHidden(reviewId, isHidden, reason = "") {
  const review = await findReview(reviewId);
  const before = { isHidden: Boolean(review.isHidden), hiddenReason: review.hiddenReason || "" };
  review.isHidden = isHidden;
  review.hiddenReason = isHidden ? reason : "";
  await review.save();
  const rating = await reviewService.refreshProductRating(review.product._id || review.product);
  return { review: toAdminReview(review), before, rating };
}

async function deleteReview(reviewId) {
  const review = await findReview(reviewId);
  const snapshot = toAdminReview(review);
  await review.deleteOne();
  const rating = await reviewService.refreshProductRating(snapshot.product ? snapshot.product.id : review.product);
  return { review: snapshot, rating };
}

// The product filter's dropdown: only products that actually have reviews.
async function reviewedProducts() {
  const ids = await Review.distinct("product");
  if (!ids.length) return [];
  return Product.find({ _id: { $in: ids } }).sort({ name: 1 }).select("name").lean();
}

module.exports = { PAGE_SIZE, VISIBILITIES, VISIBILITY_LABELS, SORTS, readFilters, listReviews, setHidden, deleteReview, reviewedProducts };
