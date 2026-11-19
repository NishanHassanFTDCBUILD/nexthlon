// The admin Deal of the Day API. A deal changes what shoppers pay, so every change is audit-logged
// and uses the stricter money rate limit (routes/adminRoutes.js).
const dealService = require('../services/dealService');
const auditService = require('../services/auditService');
const {validateDeal, hasErrors} = require('../utils/validators');
const {HttpError, asyncHandler} = require('../utils/http');

const snapshot = (deal) => ({
  product: deal.product ? deal.product.name : deal.productId,
  percent: deal.percent,
  startsAt: deal.startsAt,
  endsAt: deal.endsAt,
  isActive: deal.isActive,
  sortOrder: deal.sortOrder,
});

function checked(body) {
  const {errors, value} = validateDeal(body);
  if (hasErrors(errors))
    throw new HttpError(400, 'Please fix the highlighted fields.', errors);
  return value;
}

const nameOf = (deal) => (deal.product ? deal.product.name : 'The product');

// GET /api/admin/deals?q=&status=&sort=&page=
const listDeals = asyncHandler(async (req, res) => {
  res.json(await dealService.listDeals(req.query));
});

// GET /api/admin/deals/:dealId
const getDeal = asyncHandler(async (req, res) => {
  res.json({deal: await dealService.getDeal(req.params.dealId)});
});

// GET /api/admin/deals/products?q=   The product picker in the deal form.
const searchProducts = asyncHandler(async (req, res) => {
  res.json({products: await dealService.searchProducts(req.query.q)});
});

// POST /api/admin/deals   body: product or products[], percent, startsAt, endsAt, sortOrder, note, isActive
// Several products get the same deal, one deal each, all saved or none.
const createDeal = asyncHandler(async (req, res) => {
  const {deal, deals} = await dealService.createDeal(checked(req.body));
  await Promise.all(
    deals.map((one) =>
      auditService.record({
        ...auditService.fromRequest(req),
        action: 'deal.created',
        target: `deal:${one.id}`,
        after: snapshot(one),
      }),
    ),
  );
  res.status(201).json({
    message:
      deals.length === 1
        ? `Deal saved: ${deal.percent}% off ${nameOf(deal)}.`
        : `${deals.length} deals saved: ${deal.percent}% off each product.`,
    deal,
    deals,
  });
});

// PATCH /api/admin/deals/:dealId
const updateDeal = asyncHandler(async (req, res) => {
  const before = await dealService.getDeal(req.params.dealId);
  const deal = await dealService.updateDeal(
    req.params.dealId,
    checked(req.body),
  );
  await auditService.record({
    ...auditService.fromRequest(req),
    action: 'deal.updated',
    target: `deal:${deal.id}`,
    before: snapshot(before),
    after: snapshot(deal),
  });
  res.json({message: `Deal on ${nameOf(deal)} has been saved.`, deal});
});

// PATCH /api/admin/deals/:dealId/active   body: { "isActive": false }
const setActive = asyncHandler(async (req, res) => {
  const {isActive} = req.body || {};
  if (typeof isActive !== 'boolean')
    throw new HttpError(400, 'isActive must be true or false.');
  const deal = await dealService.setActive(req.params.dealId, isActive);
  await auditService.record({
    ...auditService.fromRequest(req),
    action: isActive ? 'deal.enabled' : 'deal.disabled',
    target: `deal:${deal.id}`,
    after: snapshot(deal),
  });
  res.json({
    message: isActive
      ? `Deal on ${nameOf(deal)} is switched on.`
      : `Deal on ${nameOf(deal)} is switched off. Its usual price is back.`,
    deal,
  });
});

// DELETE /api/admin/deals/:dealId
const deleteDeal = asyncHandler(async (req, res) => {
  const deal = await dealService.deleteDeal(req.params.dealId);
  await auditService.record({
    ...auditService.fromRequest(req),
    action: 'deal.deleted',
    target: `deal:${deal.id}`,
    before: snapshot(deal),
  });
  res.json({message: `Deal on ${nameOf(deal)} has been deleted.`, deal});
});

module.exports = {
  listDeals,
  searchProducts,
  getDeal,
  createDeal,
  updateDeal,
  setActive,
  deleteDeal,
};
