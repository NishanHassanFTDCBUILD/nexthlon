// Admin pages for the Catalog group (inventory) and for System status.
// Thin handlers: every number comes from a service, and these only choose what the page shows.
const config = require("../config/env");
const inventoryService = require("../services/inventoryService");
const systemService = require("../services/systemService");
const { linkBuilder } = require("../utils/queryString");
const { asyncHandler } = require("../utils/http");

const base = section => `${config.adminPath}/${section}`;
// The current filters without their defaults, so links stay short.
const without = (filters, defaults) => Object.fromEntries(
  Object.entries(filters).filter(([key, value]) => key !== "page" && value !== defaults[key] && value !== "" && value !== 0 && value !== "all")
);

// GET <ADMIN_PATH>/inventory
const inventory = asyncHandler(async (req, res) => {
  const data = await inventoryService.listInventory(req.query);
  const current = without(data.filters, { sort: "stock_asc" });
  res.render("admin/inventory", {
    title: "Inventory | Nexthlon Admin",
    ...data,
    current,
    link: linkBuilder(base("inventory"), current),
    exportQuery: new URLSearchParams(current).toString()
  });
});

// GET <ADMIN_PATH>/system
const system = asyncHandler(async (req, res) => {
  res.render("admin/system", { title: "System status | Nexthlon Admin", ...await systemService.status() });
});

module.exports = { inventory, system };
