// The admin API for the Catalog group: inventory corrections, plus the System status check.
// Every change is written to the audit log, so there is always a record of who changed what.
const inventoryService = require("../services/inventoryService");
const systemService = require("../services/systemService");
const auditService = require("../services/auditService");
const stockAlertService = require("../services/stockAlertService");
const { validateStockChange, hasErrors } = require("../utils/validators");
const { row } = require("../utils/csv");
const { optionLabel } = require("../utils/options");
const { HttpError, asyncHandler } = require("../utils/http");

const rupees = paise => (Number(paise || 0) / 100).toFixed(2);

function checked(validate, body) {
  const { errors, value } = validate(body || {});
  if (hasErrors(errors)) throw new HttpError(400, Object.values(errors)[0], errors);
  return value;
}

// ---------- Inventory ----------

// GET /api/admin/inventory?q=&category=&status=&sort=&page=
const listInventory = asyncHandler(async (req, res) => {
  res.json(await inventoryService.listInventory(req.query));
});

// One stock change: applied, written to the audit log (the stock history), and back-in-stock
// shoppers are emailed when units came back. Shared by the single and bulk routes.
async function applyChange(req, productId, value) {
  const result = await inventoryService.adjustStock(productId, value);
  if (result.after > result.before) stockAlertService.kick();
  await auditService.record({
    ...auditService.fromRequest(req),
    action: "inventory.stock_changed",
    target: `product:${result.product.id}`,
    before: { stock: result.before, ...(result.option ? { option: result.option.label } : {}) },
    after: { stock: result.after, action: value.action, units: value.units, note: value.note, ...(result.option ? { option: result.option.label, optionId: result.option.id } : {}) }
  });
  return result;
}

const describe = result => {
  const moved = result.after - result.before;
  const how = moved === 0 ? "unchanged" : moved > 0 ? `up ${moved}` : `down ${Math.abs(moved)}`;
  const name = result.option ? `${result.product.name} (${result.option.label})` : result.product.name;
  return `${name}: stock ${how}, now ${result.after}.`;
};

// PATCH /api/admin/inventory/:productId   body: { action: "add"|"remove"|"count", units, note?, optionId? }
// The reply has the stock before and after, so the page can offer Undo.
const adjustStock = asyncHandler(async (req, res) => {
  const value = checked(validateStockChange, req.body);
  const result = await applyChange(req, req.params.productId, value);
  res.json({ message: describe(result), product: result.product, option: result.option || null, before: result.before, after: result.after });
});

// GET /api/admin/inventory/:productId/history   The last 20 stock changes.
const stockHistory = asyncHandler(async (req, res) => {
  res.json({ history: await inventoryService.history(req.params.productId) });
});

// POST /api/admin/inventory/bulk   body: { productIds: [...], action, units, note? }
// Products with sizes or colours are skipped: their stock is changed one size at a time.
const MAX_BULK = 50;
const bulkAdjust = asyncHandler(async (req, res) => {
  const value = checked(validateStockChange, req.body);
  const ids = Array.isArray(req.body && req.body.productIds) ? [...new Set(req.body.productIds.map(String))].slice(0, MAX_BULK) : [];
  if (!ids.length) throw new HttpError(400, "Choose at least one product.");
  const done = [];
  const skipped = [];
  for (const id of ids) {
    try {
      const result = await applyChange(req, id, { ...value, optionId: null });
      done.push(result.product);
    } catch (error) {
      skipped.push({ id, reason: error.reason === "option_required" ? "Has sizes or colours: change them in its row." : error.message });
    }
  }
  const message = `${done.length} ${done.length === 1 ? "product" : "products"} updated${skipped.length ? `, ${skipped.length} skipped` : ""}.`;
  res.json({ message, products: done, skipped });
});

// GET /api/admin/inventory/export.csv?...   One line per product that matches the filters.
const exportInventory = asyncHandler(async (req, res) => {
  const { cursor } = inventoryService.cursorFor(req.query);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="nexthlon-inventory-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.write("﻿");
  res.write(row(["Product", "Size / colour", "SKU", "Brand", "Category", "Listed", "Stock", "State", "Selling price (Rs)", "Stock value (Rs)", "Last changed"]));
  for await (const product of cursor) {
    // A product with sizes or colours: its total line, then one line per size.
    const line = (option, item) => row([
      product.name,
      option,
      item.sku || "",
      product.brand || "",
      product.category ? product.category.name : "",
      product.isListed === false ? "No" : "Yes",
      item.stock,
      inventoryService.stateOf(item),
      rupees(product.price),
      rupees(item.stock * product.price),
      product.updatedAt ? new Date(product.updatedAt).toISOString() : ""
    ]);
    const options = product.variants || [];
    res.write(line(options.length ? "All" : "", product));
    options.forEach(option => res.write(line(optionLabel(option), option)));
  }
  res.end();
});

// ---------- System status ----------

// GET /api/admin/system   The same figures as the System status page, for a quick check.
const systemStatus = asyncHandler(async (req, res) => {
  res.json(await systemService.status());
});

module.exports = {
  listInventory,
  adjustStock,
  stockHistory,
  bulkAdjust,
  exportInventory,
  systemStatus
};
