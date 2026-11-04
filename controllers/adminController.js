const adminService = require("../services/adminService");
const settingsService = require("../services/settingsService");
const { validateReferralSetting, hasErrors } = require("../utils/validators");
const { HttpError, asyncHandler } = require("../utils/http");

// GET /api/admin/dashboard
const dashboard = asyncHandler(async (req, res) => {
  res.json(await adminService.getDashboardStats());
});

// GET /api/admin/customers?q=&status=all|active|blocked&page=
const listCustomers = asyncHandler(async (req, res) => {
  res.json(await adminService.listCustomers(req.query));
});

// PATCH /api/admin/customers/:userId/block   body: { "isBlocked": true }
// A blocked customer is rejected on their very next request, because every request checks the database.
const setCustomerBlocked = asyncHandler(async (req, res) => {
  const { isBlocked } = req.body || {};
  if (typeof isBlocked !== "boolean") {
    throw new HttpError(400, "isBlocked must be true or false.");
  }
  const customer = await adminService.setCustomerBlocked(req.params.userId, isBlocked);
  res.json({
    //condition ? valueIfTrue : valueIfFalse
    message: isBlocked ? `${customer.name} has been blocked.` : `${customer.name} has been unblocked.`,
    customer
  });
});

// GET /api/admin/settings   Store settings (amounts in paise).
const getSettings = asyncHandler(async (req, res) => {
  res.json({ settings: await settingsService.getAll() });
});

// PATCH /api/admin/settings/referral   body: { referralReward } in rupees, 0 to 1000.
const updateReferral = asyncHandler(async (req, res) => {
  const { errors, value } = validateReferralSetting(req.body);
  if (hasErrors(errors)) throw new HttpError(400, Object.values(errors)[0], errors);
  const settings = await settingsService.set("referralReward", value.referralReward);
  res.json({ message: value.referralReward ? "Referral reward saved." : "Referral rewards are turned off.", settings });
});

module.exports = { dashboard, listCustomers, setCustomerBlocked, getSettings, updateReferral };
