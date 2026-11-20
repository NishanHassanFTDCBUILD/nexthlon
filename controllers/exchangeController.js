// Size exchange: the customer's request, and the team's decision and completion (services/exchangeService.js).
const exchangeService = require('../services/exchangeService');
const auditService = require('../services/auditService');
const {asyncHandler, HttpError} = require('../utils/http');

// POST /api/orders/:orderId/exchange   body: { itemId, variantId }
const requestExchange = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const order = await exchangeService.requestExchange(
    req.user._id,
    req.params.orderId,
    body.itemId,
    body.variantId,
  );
  res.json({
    message: 'Exchange requested. We will confirm it shortly.',
    orderId: order.orderId,
  });
});

// POST /api/admin/orders/:orderId/items/:itemId/exchange   body: { action: approve | decline | complete }
const decide = asyncHandler(async (req, res) => {
  const action = (req.body || {}).action;
  let order;
  if (action === 'approve' || action === 'decline') {
    order = await exchangeService.decideExchange(
      req.params.orderId,
      req.params.itemId,
      action,
    );
  } else if (action === 'complete') {
    order = await exchangeService.completeExchange(
      req.params.orderId,
      req.params.itemId,
    );
  } else {
    throw new HttpError(
      400,
      'The action must be approve, decline or complete.',
    );
  }
  await auditService.record({
    ...auditService.fromRequest(req),
    action: `exchange.${action}`,
    target: `order:${order.orderId}`,
    after: {itemId: req.params.itemId, action},
  });
  res.json({
    message: `Exchange ${action === 'complete' ? 'completed' : action + 'd'}.`,
  });
});

module.exports = {requestExchange, decide};
