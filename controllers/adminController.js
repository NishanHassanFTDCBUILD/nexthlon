const supportService = require("../services/supportService");
const auditService = require("../services/auditService");
const SupportTicket = require("../models/SupportTicket");
const adminService = require("../services/adminService");
const dashboardService = require("../services/dashboardService");
const analyticsService = require("../services/analyticsService");
const settingsService = require("../services/settingsService");
const { validateReferralSetting, validateCodSetting, validateTicketReply, validateAdminSearch, hasErrors } = require("../utils/validators");
const { HttpError, asyncHandler } = require("../utils/http");
const { formatPaise } = require("../utils/money");

// GET /api/admin/dashboard?range=today|7d|30d|month|year|custom&from=&to=
// The store counts (stats) plus KPIs, chart series and panels for the date range.
const dashboard = asyncHandler(async (req, res) => {
  const [stats, data] = await Promise.all([adminService.getDashboardStats(), dashboardService.dashboard(req.query)]);
  res.json({ ...stats, ...data });
});

// GET /api/admin/analytics?range=&by=day|week|month&from=&to=
// Everything the Analytics section shows. The page renders it server-side; this is for scripts
// and for checking the numbers without opening the console.
const analytics = asyncHandler(async (req, res) => {
  res.json(await analyticsService.analytics(req.query));
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
  const before = await settingsService.get("referralReward");
  const settings = await settingsService.set("referralReward", value.referralReward);
  await auditService.record({ ...auditService.fromRequest(req), action: "settings.updated", target: "setting:referralReward", before: { referralReward: before }, after: { referralReward: value.referralReward } });
  res.json({ message: value.referralReward ? "Referral reward saved." : "Referral rewards are turned off.", settings });
});

// PATCH /api/admin/settings/cod   body: { codLimit } in rupees, 0 to 50,000 (0 turns cash on delivery off).
// Checkout and product pages read it on every request, so a change takes effect at once.
const updateCod = asyncHandler(async (req, res) => {
  const { errors, value } = validateCodSetting(req.body);
  if (hasErrors(errors)) throw new HttpError(400, Object.values(errors)[0], errors);
  const before = await settingsService.get("codLimit");
  const settings = await settingsService.set("codLimit", value.codLimit);
  await auditService.record({ ...auditService.fromRequest(req), action: "settings.updated", target: "setting:codLimit", before: { codLimit: before }, after: { codLimit: value.codLimit } });
  res.json({
    message: value.codLimit ? `Cash on delivery is now offered for orders up to ${formatPaise(value.codLimit)}.` : "Cash on delivery is turned off.",
    settings
  });
});

// ---------- Support tickets ----------

// GET /api/admin/tickets?status=open|pending|resolved
const listTickets = asyncHandler(async (req, res) => {
  res.json(await supportService.listAll(req.query));
});

// POST /api/admin/tickets/:ticketId/reply   { message, status? }
const replyTicket = asyncHandler(async (req, res) => {
  const { errors, value } = validateTicketReply(req.body, SupportTicket.STATUSES);
  if (hasErrors(errors)) throw new HttpError(400, "Please fix the highlighted fields.", errors);
  const ticket = await supportService.replyAsAdmin(req.user, req.params.ticketId, value, auditService.fromRequest(req));
  res.json({ message: "Reply sent to the customer.", ticket });
});

// GET /api/admin/search?q=   Orders, products and customers for the top bar search and Ctrl+K.
const search = asyncHandler(async (req, res) => {
  const { errors, value } = validateAdminSearch(req.query);
  if (hasErrors(errors)) throw new HttpError(400, errors.q, errors);
  res.json({ q: value.q, results: await adminService.globalSearch(value.q) });
});

// GET /api/admin/notifications   Counts for the bell: orders to confirm, returns, stock, tickets.
const notifications = asyncHandler(async (req, res) => {
  res.json(await adminService.notifications());
});

module.exports = { dashboard, analytics, search, notifications, listCustomers, setCustomerBlocked, getSettings, updateReferral, updateCod, listTickets, replyTicket };
