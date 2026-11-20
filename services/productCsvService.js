// Product spreadsheet: export the catalogue to CSV, and import edits to existing products.
//
// Import is two steps, and nothing is saved until the second one:
//   preview: every row is checked and each change is listed (from -> to), with every error
//            on its line, so the admin can fix the file in one go;
//   apply:   the same file is checked again, and only a file with no errors is saved.
//
// Blank cells keep the current value. The id column is required and cannot be changed.
// Stock is not in this file: stock changes go through Inventory (stock history, reasons).
// Prices are in rupees in the file and stored in paise. Money is never rounded by a float.
const mongoose = require('mongoose');
const Product = require('../models/Product');
const Category = require('../models/Category');
const auditService = require('./auditService');
const {parseCsv} = require('../utils/parseCsv');
const {row} = require('../utils/csv');
const {HttpError} = require('../utils/http');

const COLUMNS = [
  'id',
  'name',
  'brand',
  'category',
  'price',
  'mrp',
  'offerPercent',
  'isListed',
];
const MAX_ROWS = 500;
const MAX_RUPEES = 10000000;
const MONEY = /^\d{1,8}(\.\d{1,2})?$/;

const rupees = (paise) => (Number(paise || 0) / 100).toFixed(2);

// Every product, for the spreadsheet. Newest category order is not needed: sorted by name.
async function exportCsv() {
  const products = await Product.find({})
    .sort({name: 1})
    .limit(10000)
    .select('name brand category basePrice mrp offerPercent isListed')
    .populate('category', 'name')
    .lean();
  const header = row(COLUMNS);
  const lines = products.map((p) =>
    row([
      String(p._id),
      p.name,
      p.brand || '',
      p.category && p.category.name ? p.category.name : '',
      rupees(p.basePrice),
      rupees(p.mrp),
      p.offerPercent || 0,
      p.isListed === false ? 'no' : 'yes',
    ]),
  );
  return header + lines.join('');
}

function readCsv(text) {
  if (typeof text !== 'string' || !text.trim())
    throw new HttpError(400, 'Choose a CSV file to import.', {
      csv: 'Choose a CSV file to import.',
    });
  const [header = [], ...rows] = parseCsv(text);
  const bom = new RegExp(String.fromCharCode(0xfeff));
  const names = header.map((cell) => String(cell).trim().replace(bom, ''));
  if (!names.includes('id'))
    throw new HttpError(
      400,
      'The first row must have the column headers, and one of them must be id.',
    );
  const unknown = names.filter((key) => !COLUMNS.includes(key));
  if (unknown.length)
    throw new HttpError(
      400,
      `These columns are not used: ${unknown.join(', ')}. Use only ${COLUMNS.join(', ')}.`,
    );
  if (new Set(names).size !== names.length)
    throw new HttpError(400, 'Each column can appear only once.');
  if (rows.length > MAX_ROWS)
    throw new HttpError(400, `Import up to ${MAX_ROWS} products at a time.`);
  return rows
    .map((cells, index) => ({
      line: index + 2,
      cells: Object.fromEntries(
        names.map((key, i) => [key, String(cells[i] ?? '').trim()]),
      ),
    }))
    .filter((r) => Object.values(r.cells).some((value) => value !== ''));
}

// Checks one row against the product it names. Returns the changes and the errors.
function checkRow(entry, product, categories) {
  const errors = [];
  const changes = {};
  const c = entry.cells;
  const set = (field, from, to) => {
    if (String(from) !== String(to)) changes[field] = {from, to};
  };

  if (!product) {
    errors.push(
      'No product has this id. Export the list again and use its ids.',
    );
    return {changes, errors};
  }

  if (c.name !== undefined && c.name !== '') {
    if (c.name.length < 2 || c.name.length > 120)
      errors.push('name must be 2 to 120 characters.');
    else set('name', product.name, c.name);
  }
  if (c.brand) {
    if (c.brand.length > 60)
      errors.push('brand must be 60 characters or fewer.');
    else set('brand', product.brand || '', c.brand);
  }
  if (c.category) {
    const match = categories.get(c.category.toLowerCase());
    if (!match)
      errors.push(
        `category "${c.category}" does not exist. Create it under Categories first.`,
      );
    else set('category', product.categoryName || '', match.name);
  }

  let basePaise = product.basePrice;
  if (c.price) {
    if (
      !MONEY.test(c.price) ||
      Number(c.price) <= 0 ||
      Number(c.price) > MAX_RUPEES
    )
      errors.push(
        'price must be a rupee amount above 0, with at most 2 decimals.',
      );
    else {
      basePaise = Math.round(Number(c.price) * 100);
      set('price', rupees(product.basePrice), rupees(basePaise));
    }
  }
  if (c.mrp) {
    if (!MONEY.test(c.mrp) || Number(c.mrp) <= 0 || Number(c.mrp) > MAX_RUPEES)
      errors.push(
        'mrp must be a rupee amount above 0, with at most 2 decimals.',
      );
    else {
      const mrpPaise = Math.round(Number(c.mrp) * 100);
      if (mrpPaise < basePaise)
        errors.push('mrp cannot be less than the price.');
      else set('mrp', rupees(product.mrp), rupees(mrpPaise));
    }
  }
  if (c.offerPercent !== undefined && c.offerPercent !== '') {
    const offer = Number(c.offerPercent);
    if (!/^\d{1,2}$/.test(c.offerPercent) || offer > 90)
      errors.push('offerPercent must be a whole number from 0 to 90.');
    else set('offerPercent', product.offerPercent || 0, offer);
  }
  if (c.isListed) {
    const value = c.isListed.toLowerCase();
    if (!['yes', 'no', 'true', 'false'].includes(value))
      errors.push('isListed must be yes or no.');
    else
      set(
        'isListed',
        product.isListed === false ? 'no' : 'yes',
        ['yes', 'true'].includes(value) ? 'yes' : 'no',
      );
  }
  return {changes, errors};
}

async function loadContext(rows) {
  const ids = [
    ...new Set(
      rows.map((r) => r.cells.id).filter((id) => mongoose.isValidObjectId(id)),
    ),
  ];
  const products = await Product.find({_id: {$in: ids}})
    .select('name brand category basePrice mrp offerPercent isListed')
    .populate('category', 'name')
    .lean();
  const byId = new Map(products.map((p) => [String(p._id), p]));
  const categories = new Map(
    (await Category.find().select('name').lean()).map((cat) => [
      cat.name.toLowerCase(),
      cat,
    ]),
  );
  return {byId, categories};
}

const withName = (p) =>
  p && {
    ...p,
    categoryName: p.category && p.category.name ? p.category.name : '',
  };

// Step one: check every row and say what would change. Saves nothing.
async function preview(text) {
  const rows = readCsv(text);
  const {byId, categories} = await loadContext(rows);
  const result = rows.map((entry) => {
    const id = entry.cells.id;
    const product = withName(byId.get(id));
    const {changes, errors} = mongoose.isValidObjectId(id)
      ? checkRow(entry, product, categories)
      : {changes: {}, errors: ['The id is not a valid product id.']};
    return {
      line: entry.line,
      id,
      name: product ? product.name : '',
      changes,
      errors,
    };
  });
  return {
    rows: result,
    summary: {
      rows: result.length,
      changed: result.filter(
        (r) => Object.keys(r.changes).length && !r.errors.length,
      ).length,
      unchanged: result.filter(
        (r) => !Object.keys(r.changes).length && !r.errors.length,
      ).length,
      errors: result.filter((r) => r.errors.length).length,
    },
    canApply: result.length > 0 && result.every((r) => !r.errors.length),
  };
}

// Step two: save the changes, only if the whole file is clean.
// auditContext is auditService.fromRequest(req): who is making the change.
async function apply(text, auditContext) {
  const rows = readCsv(text);
  const {byId, categories} = await loadContext(rows);
  const plan = rows.map((entry) => {
    const id = entry.cells.id;
    const product = withName(byId.get(id));
    const checked = mongoose.isValidObjectId(id)
      ? checkRow(entry, product, categories)
      : {changes: {}, errors: ['The id is not a valid product id.']};
    return {line: entry.line, id, product, ...checked};
  });
  const bad = plan.filter((r) => r.errors.length);
  if (bad.length)
    throw new HttpError(
      409,
      `Nothing was saved: ${bad.length} ${bad.length === 1 ? 'row has' : 'rows have'} errors. Fix them and try again.`,
      {
        rows: bad.map((r) => ({line: r.line, errors: r.errors})),
      },
    );
  let saved = 0;
  for (const entry of plan) {
    if (!Object.keys(entry.changes).length) continue;
    const product = await Product.findById(entry.id);
    if (!product) continue;
    const before = {};
    const after = {};
    for (const [field, change] of Object.entries(entry.changes)) {
      before[field] = change.from;
      after[field] = change.to;
    }
    if (entry.changes.category) {
      const category = categories.get(entry.changes.category.to.toLowerCase());
      product.category = category._id;
      product.categoryOffer = category.offerPercent || 0;
      product.categoryListed = category.isListed !== false;
    }
    if (entry.changes.name) product.name = entry.changes.name.to;
    if (entry.changes.brand) product.brand = entry.changes.brand.to;
    if (entry.changes.price)
      product.basePrice = Math.round(Number(entry.changes.price.to) * 100);
    if (entry.changes.mrp)
      product.mrp = Math.round(Number(entry.changes.mrp.to) * 100);
    if (entry.changes.offerPercent)
      product.offerPercent = Number(entry.changes.offerPercent.to);
    if (entry.changes.isListed)
      product.isListed = entry.changes.isListed.to === 'yes';
    await product.save();
    saved += 1;
    await auditService.record({
      ...auditContext,
      action: 'product.updated',
      target: `product:${entry.id}`,
      before,
      after,
    });
  }
  // Saving each product clears the shop's catalogue cache (models/Product.js), so no extra step.
  return {saved, unchanged: plan.length - saved};
}

module.exports = {COLUMNS, MAX_ROWS, exportCsv, preview, apply, readCsv};
