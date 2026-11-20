// Review moderation for the team: find reviews, hide one from the store (with a reason), and show
// it again. Hiding takes the review out of the product's average (refreshProductRating).
const mongoose = require('mongoose');
const Review = require('../models/Review');
const {refreshProductRating} = require('./reviewService');
const {HttpError} = require('../utils/http');
const {pageSize} = require('../utils/paging');

const STATUSES = ['all', 'visible', 'hidden'];
const HIDE_REASONS = [
  'Spam',
  'Offensive or abusive',
  'Off topic',
  'Fake or paid',
  'Other',
];

const toPage = (value) => {
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n > 0 && n < 100000 ? n : 1;
};

function readFilters(query = {}) {
  const rating = Number.parseInt(query.rating, 10);
  return {
    status: STATUSES.includes(query.status) ? query.status : 'all',
    rating: rating >= 1 && rating <= 5 ? rating : 0,
    page: toPage(query.page),
  };
}

async function listReviews(query = {}) {
  const filters = readFilters(query);
  const size = pageSize(query, 20);
  const filter = {};
  if (filters.status === 'visible') filter.isHidden = {$ne: true};
  if (filters.status === 'hidden') filter.isHidden = true;
  if (filters.rating) filter.rating = filters.rating;
  const [rows, total, counts] = await Promise.all([
    Review.find(filter)
      .sort({createdAt: -1, _id: -1})
      .skip((filters.page - 1) * size)
      .limit(size)
      .populate('product', 'name slug image')
      .populate('user', 'name')
      .lean(),
    Review.countDocuments(filter),
    Review.aggregate([{$group: {_id: '$isHidden', count: {$sum: 1}}}]),
  ]);
  const hiddenCount = (counts.find((row) => row._id === true) || {count: 0})
    .count;
  const visibleCount = (counts.find((row) => row._id !== true) || {count: 0})
    .count;
  return {
    reviews: rows.map((r) => ({
      id: String(r._id),
      rating: r.rating,
      title: r.title || '',
      body: r.body,
      verified: Boolean(r.verified),
      isHidden: Boolean(r.isHidden),
      hiddenReason: r.hiddenReason || '',
      author: r.user && r.user.name ? r.user.name : 'Former customer',
      product: r.product
        ? {
            id: String(r.product._id),
            name: r.product.name,
            slug: r.product.slug,
            image: r.product.image,
          }
        : null,
      createdAt: r.createdAt,
    })),
    filters,
    counts: {
      all: hiddenCount + visibleCount,
      visible: visibleCount,
      hidden: hiddenCount,
    },
    reasons: HIDE_REASONS,
    pagination: {
      page: filters.page,
      pages: Math.max(1, Math.ceil(total / size)),
      total,
      limit: size,
    },
  };
}

// Hides (with a reason) or shows a review. Returns the review's state before and after.
async function setHidden(reviewId, hidden, reason = '') {
  if (!mongoose.isValidObjectId(reviewId))
    throw new HttpError(404, 'Review not found.');
  const review = await Review.findById(reviewId);
  if (!review) throw new HttpError(404, 'Review not found.');
  const before = {
    isHidden: Boolean(review.isHidden),
    hiddenReason: review.hiddenReason || '',
  };
  const cleanReason = hidden
    ? String(reason || '')
        .trim()
        .slice(0, 200)
    : '';
  if (hidden && !cleanReason)
    throw new HttpError(400, 'Choose why it is hidden.', {
      reason: 'Choose why it is hidden.',
    });
  review.isHidden = hidden;
  review.hiddenReason = cleanReason;
  await review.save();
  await refreshProductRating(review.product);
  return {
    productId: String(review.product),
    before,
    after: {isHidden: hidden, hiddenReason: cleanReason},
  };
}

module.exports = {STATUSES, HIDE_REASONS, listReviews, setHidden};
