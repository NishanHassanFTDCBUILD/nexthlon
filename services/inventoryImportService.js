const mongoose = require('mongoose');
const Product = require('../models/Product');
const InventoryBatch = require('../models/InventoryBatch');
const {parseCsv} = require('../utils/parseCsv');
const {validateStockChange} = require('../utils/validators');
const {HttpError} = require('../utils/http');
const {optionLabel} = require('../utils/options');

const COLUMNS = ['productId', 'optionId', 'units', 'reason', 'note'];

function readRows(body = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new HttpError(400, 'Supply an import request.');
  if (typeof body.csv === 'string') {
    const [header = [], ...rows] = parseCsv(body.csv);
    const names = header.map((key) => key.trim());
    if (
      new Set(names).size !== names.length ||
      names.some((key) => !COLUMNS.includes(key)) ||
      !['productId', 'units', 'reason'].every((key) => names.includes(key))
    )
      throw new HttpError(
        400,
        'CSV headers must include productId, units and reason; optionId and note are optional.',
      );
    return rows.map((row) => {
      if (row.length !== names.length)
        throw new HttpError(
          400,
          'Every CSV row must have the same number of cells as the header.',
        );
      return Object.fromEntries(names.map((key, i) => [key, row[i].trim()]));
    });
  }
  if (!Array.isArray(body.rows))
    throw new HttpError(
      400,
      'Choose a CSV file or select products to restock.',
    );
  return body.rows;
}

async function preview(body, actor, now = new Date()) {
  const rows = readRows(body);
  if (!rows.length || rows.length > 100)
    throw new HttpError(400, 'Choose between 1 and 100 stock rows.');
  const ids = rows
    .filter(
      (row) =>
        row &&
        typeof row.productId === 'string' &&
        mongoose.isValidObjectId(row.productId),
    )
    .map((row) => row.productId);
  const products = await Product.find({_id: {$in: ids}})
    .select('name stock variants')
    .lean();
  const byId = new Map(
    products.map((product) => [String(product._id), product]),
  );
  const seen = new Set();
  const additions = new Map();
  const prepared = rows.map((row, index) => {
    const input =
      row && typeof row === 'object' && !Array.isArray(row) ? row : {};
    const {errors, value} = validateStockChange({...input, action: 'add'});
    if (typeof input.reason !== 'string' || !input.reason.trim())
      errors.reason = 'Choose a reason.';
    if (typeof input.note === 'string' && input.note.length > 120)
      errors.note = 'Keep notes within 120 characters.';
    const product = byId.get(input.productId);
    if (!product) errors.productId = 'Product not found.';
    const optionId = typeof input.optionId === 'string' ? input.optionId : '';
    const option = product?.variants?.find(
      (item) => String(item._id) === optionId,
    );
    if (product?.variants?.length && !option)
      errors.optionId = 'Choose a valid size or colour option.';
    if (product && !product.variants?.length && optionId)
      errors.optionId = 'This product has no size or colour options.';
    const key = `${input.productId}:${optionId}`;
    if (seen.has(key))
      errors.productId = 'This product/option is repeated in the import.';
    seen.add(key);
    const added =
      (additions.get(input.productId) || 0) +
      (Number.isInteger(value.units) ? value.units : 0);
    additions.set(input.productId, added);
    if (product && product.stock + added > 100000)
      errors.units = 'The product total would exceed 100,000 units.';
    const name = product
      ? `${product.name}${option ? ` (${optionLabel(option)})` : ''}`
      : '';
    return {
      row: index + 2,
      productId: typeof input.productId === 'string' ? input.productId : '',
      optionId,
      name,
      units: value.units,
      reason: value.reason,
      note: value.note,
      errors,
    };
  });
  const valid = prepared.every((row) => Object.keys(row.errors).length === 0);
  if (!valid) return {rows: prepared, batchId: null, valid: false};
  const batch = await InventoryBatch.create({
    actor,
    recoveryVersion: 1,
    rows: prepared,
    applyBefore: new Date(now.getTime() + 15 * 60 * 1000),
    expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
  });
  return {rows: prepared, batchId: String(batch._id), valid: true};
}

// One durable claim prevents double-clicks and retries from applying the same batch twice.
// A crash after a stock write leaves "applying": it requires review, never an automatic replay.
async function apply(batchId, actor, change, now = new Date()) {
  if (!mongoose.isValidObjectId(batchId))
    throw new HttpError(404, 'Import preview not found.');
  const lockToken = require('node:crypto').randomUUID();
  const batch = await InventoryBatch.findOneAndUpdate(
    {
      _id: batchId,
      actor,
      $or: [
        {status: 'preview', applyBefore: {$gt: now}},
        {status: 'applying', recoveryVersion: 1, lockedUntil: {$lte: now}},
        {
          status: 'completed',
          recoveryVersion: 1,
          results: {$elemMatch: {status: 'review'}},
        },
      ],
    },
    {
      $set: {
        status: 'applying',
        lockToken,
        lockedUntil: new Date(now.getTime() + 5 * 60 * 1000),
      },
    },
    {new: true},
  );
  if (!batch) {
    const previous = await InventoryBatch.findOne({_id: batchId, actor}).lean();
    if (!previous) throw new HttpError(404, 'Import preview not found.');
    if (previous.status === 'completed')
      return {status: previous.status, results: previous.results};
    throw new HttpError(
      409,
      previous.status === 'applying'
        ? 'This batch is running. Recovery is available after its five-minute lease expires.'
        : 'The preview expired. Prepare a new preview.',
    );
  }
  const results = [...(batch.results || [])].map((row) =>
    row.toObject ? row.toObject() : row,
  );
  for (const [index, row] of batch.rows.entries()) {
    if (
      results.some(
        (result) => result.row === index + 2 && result.status === 'applied',
      )
    )
      continue;
    let outcome;
    try {
      await change(row.productId, {
        action: 'add',
        units: row.units,
        optionId: row.optionId || null,
        reason: row.reason,
        note: row.note,
        requestId: `batch:${batchId}:${index}`,
      });
      outcome = {
        row: index + 2,
        productId: row.productId,
        status: 'applied',
        message: 'Stock added.',
      };
    } catch (error) {
      // Even an uncertain database response is never retried automatically.
      outcome = {
        row: index + 2,
        productId: row.productId,
        status: 'review',
        message:
          error instanceof HttpError
            ? error.message
            : 'Change could not be confirmed. Review stock history before making another adjustment.',
      };
    }
    const previous = results.findIndex((result) => result.row === index + 2);
    if (previous < 0) results.push(outcome);
    else results[previous] = outcome;
    const saved = await InventoryBatch.updateOne(
      {_id: batchId, actor, lockToken},
      {
        $set: {results, lockedUntil: new Date(Date.now() + 5 * 60 * 1000)},
      },
    );
    if (!saved.matchedCount)
      throw new HttpError(
        409,
        'Another worker is recovering this batch. Refresh its progress.',
      );
  }
  const completed = await InventoryBatch.updateOne(
    {_id: batchId, actor, lockToken},
    {
      $set: {results, status: 'completed'},
      $unset: {lockedUntil: 1, lockToken: 1},
    },
  );
  if (!completed.matchedCount)
    throw new HttpError(409, 'The import lease changed. Refresh its progress.');
  return {status: 'completed', results};
}

module.exports = {COLUMNS, readRows, preview, apply};
