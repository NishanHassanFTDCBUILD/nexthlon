// Gift cards: the customer's redeem call, and the team's list and switch-off (see services/giftCardService.js).
const giftCardService = require('../services/giftCardService');
const auditService = require('../services/auditService');
const config = require('../config/env');
const {asyncHandler} = require('../utils/http');
const {linkBuilder} = require('../utils/queryString');

// POST /api/wallet/gift-cards/redeem   body: { code }
const redeem = asyncHandler(async (req, res) => {
  const result = await giftCardService.redeem(
    req.user._id,
    (req.body || {}).code,
  );
  res.json(result);
});

// GET /api/admin/gift-cards?status=active|redeemed|disabled
const listApi = asyncHandler(async (req, res) => {
  res.json({cards: await giftCardService.list(req.query)});
});

// POST /api/admin/gift-cards/:cardId/disable
const disableApi = asyncHandler(async (req, res) => {
  const card = await giftCardService.disable(req.params.cardId);
  await auditService.record({
    ...auditService.fromRequest(req),
    action: 'gift_card.disabled',
    target: `gift-card:${card._id}`,
    before: {status: 'active'},
    after: {status: 'disabled'},
  });
  res.json({
    message: 'Gift card switched off. It can no longer be redeemed.',
    card,
  });
});

// GET <ADMIN_PATH>/gift-cards?status=  (the list page)
const listPage = asyncHandler(async (req, res) => {
  const data = await giftCardService.listPage(req.query);
  res.render('admin/gift-cards', {
    title: 'Gift cards | Nexthlon Admin',
    section: 'gift-cards',
    ...data,
    link: linkBuilder(`${config.adminPath}/gift-cards`, {
      status: data.status,
      limit: data.pagination.limit === 20 ? '' : data.pagination.limit,
    }),
  });
});

module.exports = {redeem, listApi, disableApi, listPage};
