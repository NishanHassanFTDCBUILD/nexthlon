// Review moderation: the admin API and the Reviews page. Every hide or show is audit-logged.
const adminReviewService = require('../services/adminReviewService');
const auditService = require('../services/auditService');
const config = require('../config/env');
const {linkBuilder} = require('../utils/queryString');
const {asyncHandler, HttpError} = require('../utils/http');

// GET /api/admin/reviews?status=&rating=&page=
const listReviews = asyncHandler(async (req, res) => {
  res.json(await adminReviewService.listReviews(req.query));
});

// PATCH /api/admin/reviews/:reviewId/hidden   body: { hidden: true, reason: 'Spam' }
const setReviewHidden = asyncHandler(async (req, res) => {
  const body = req.body || {};
  if (typeof body.hidden !== 'boolean')
    throw new HttpError(400, 'hidden must be true or false.');
  const result = await adminReviewService.setHidden(
    req.params.reviewId,
    body.hidden,
    body.reason,
  );
  await auditService.record({
    ...auditService.fromRequest(req),
    action: body.hidden ? 'review.hidden' : 'review.shown',
    target: `review:${req.params.reviewId}`,
    before: result.before,
    after: result.after,
  });
  res.json({
    message: body.hidden
      ? 'Review hidden from the store. The product rating is updated.'
      : 'Review shown again. The product rating is updated.',
    review: {id: req.params.reviewId, ...result.after},
  });
});

// GET <ADMIN_PATH>/reviews
const reviewsPage = asyncHandler(async (req, res) => {
  const data = await adminReviewService.listReviews(req.query);
  const current = {};
  if (data.filters.status !== 'all') current.status = data.filters.status;
  if (data.filters.rating) current.rating = data.filters.rating;
  res.render('admin/reviews', {
    title: 'Reviews | Nexthlon Admin',
    ...data,
    link: linkBuilder(`${config.adminPath}/reviews`, current),
  });
});

module.exports = {listReviews, setReviewHidden, reviewsPage};
