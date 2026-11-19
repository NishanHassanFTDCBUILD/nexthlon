// Customer 360: one customer's profile page, its JSON, and the team's private note.
const customerProfileService = require('../services/customerProfileService');
const auditService = require('../services/auditService');
const config = require('../config/env');
const {asyncHandler} = require('../utils/http');

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

// GET <ADMIN_PATH>/customers/:userId
const customerPage = asyncHandler(async (req, res) => {
  const data = await customerProfileService.profile(req.params.userId);
  res.render('admin/customer', {
    title: `${data.customer.name} | Nexthlon Admin`,
    ...data,
    wallet: `${config.adminPath}/customers/${data.customer.id}/wallet`,
  });
});

module.exports = {profileApi, noteApi, customerPage};
