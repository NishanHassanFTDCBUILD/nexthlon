// Customer 360: one customer's profile page, its JSON, and the team's private note.
const customerProfileService = require('../services/customerProfileService');
const adminService = require('../services/adminService');
const auditService = require('../services/auditService');
const config = require('../config/env');
const {asyncHandler, HttpError} = require('../utils/http');

// GET /api/admin/customers/:userId/profile
const profileApi = asyncHandler(async (req, res) => {
  res.json(await customerProfileService.profile(req.params.userId));
});

// PATCH /api/admin/customers/:userId/note   body: { note }
const noteApi = asyncHandler(async (req, res) => {
  const result = await customerProfileService.setNote(
    req.params.userId,
    (req.body || {}).note,
    auditService.fromRequest(req),
  );
  res.json({message: 'Note saved. Only the team sees it.', ...result});
});

// PATCH /api/admin/customers/:userId/cod-block   body: { codBlocked }
const codBlockApi = asyncHandler(async (req, res) => {
  const {codBlocked} = req.body || {};
  if (typeof codBlocked !== 'boolean')
    throw new HttpError(400, 'codBlocked must be true or false.');
  const customer = await adminService.setCustomerCodBlocked(
    req.params.userId,
    codBlocked,
  );
  await auditService.record({
    ...auditService.fromRequest(req),
    action: codBlocked ? 'customer.cod_blocked' : 'customer.cod_allowed',
    target: `user:${customer.id}`,
    before: {codBlocked: !codBlocked},
    after: {codBlocked},
  });
  res.json({
    message: codBlocked
      ? `Cash on Delivery is off for ${customer.name}.`
      : `Cash on Delivery is back on for ${customer.name}.`,
    customer,
  });
});

// POST /api/admin/customers/:userId/sign-out-all
const signOutApi = asyncHandler(async (req, res) => {
  const customer = await adminService.signOutEverywhere(req.params.userId);
  await auditService.record({
    ...auditService.fromRequest(req),
    action: 'customer.signed_out_everywhere',
    target: `user:${customer.id}`,
  });
  res.json({message: `${customer.name} is signed out of every device.`});
});

// GET <ADMIN_PATH>/customers/:userId
const customerPage = asyncHandler(async (req, res) => {
  const data = await customerProfileService.profile(req.params.userId);
  res.render('admin/customer', {
    title: `${data.customer.name} | Nexthlon Admin`,
    ...data,
    wallet: `${config.adminPath}/customers/${data.customer.id}/wallet`,
  });
});

module.exports = {profileApi, noteApi, codBlockApi, signOutApi, customerPage};
