const adminService = require("../services/adminService");
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

module.exports = { dashboard, listCustomers, setCustomerBlocked };
