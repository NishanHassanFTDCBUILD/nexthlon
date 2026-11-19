const service = require('../services/adminWalletService');
const audit = require('../services/auditService');
const {asyncHandler} = require('../utils/http');
const config = require('../config/env');

const get = asyncHandler(async (req, res) =>
  res.json(await service.details(req.params.userId, req.query)),
);
const adjust = asyncHandler(async (req, res) => {
  const result = await service.adjust(
    req.params.userId,
    req.body,
    audit.fromRequest(req),
  );
  res.json({
    message: result.repeated
      ? 'This adjustment was already applied.'
      : 'Wallet updated.',
    ...result,
  });
});
const page = asyncHandler(async (req, res) => {
  const data = await service.details(req.params.userId, req.query);
  const base = `${config.adminPath}/customers/${data.customer.id}/wallet`;
  const link = ({page = 1} = {}) => `${base}?page=${encodeURIComponent(page)}`;
  res.render('admin/customer-wallet', {
    title: `Wallet: ${data.customer.name} | Nexthlon Admin`,
    ...data,
    link,
  });
});
module.exports = {get, adjust, page};
