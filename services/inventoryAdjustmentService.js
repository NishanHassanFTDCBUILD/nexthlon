const crypto = require('node:crypto');
const InventoryAdjustment = require('../models/InventoryAdjustment');
const AuditLog = require('../models/AuditLog');
const inventory = require('./inventoryService');
const audit = require('./auditService');
const {supportsTransactions, inTransaction} = require('../utils/transaction');
const {HttpError} = require('../utils/http');

function fingerprint(productId, value) {
  return crypto
    .createHash('sha256')
    .update(
      JSON.stringify([
        String(productId),
        value.action,
        value.units,
        value.optionId || null,
        value.reason || '',
        value.note || '',
        value.expectedStock ?? null,
        ...(value.combination
          ? [
              value.combination.size.toLowerCase(),
              value.combination.colour.toLowerCase(),
            ]
          : []),
      ]),
    )
    .digest('hex');
}

function replay(receipt, hash) {
  if (receipt.fingerprint !== hash)
    throw new HttpError(
      409,
      'This adjustment reference was already used with different values. Refresh before starting another adjustment.',
    );
  return {...receipt.result, replayed: true};
}

async function apply(context, productId, value) {
  await InventoryAdjustment.init();
  const key = {actor: context.actor, requestId: value.requestId};
  const hash = fingerprint(productId, value);
  const previous = await InventoryAdjustment.findOne(key).lean();
  if (previous) return replay(previous, hash);
  // Stock, its receipt and its audit entry must commit together. Fail before
  // changing anything on a standalone server; compensating increments are unsafe.
  if (!(await supportsTransactions()))
    throw new HttpError(
      503,
      'Safe stock adjustments require a MongoDB replica set or Atlas. No stock was changed.',
    );
  try {
    return await inTransaction(async (session) => {
      const existing = await InventoryAdjustment.findOne(key)
        .session(session)
        .lean();
      if (existing) return replay(existing, hash);
      const option = value.combination
        ? await require('./inventoryOptionService').ensureOption(
            productId,
            value.combination,
            session,
          )
        : null;
      const result = await inventory.adjustStock(productId, {
        ...value,
        ...(option ? {optionId: option.id} : {}),
        session,
      });
      if (option) result.optionCreated = option.created;
      await AuditLog.create(
        [
          {
            ...context,
            ip: audit.maskIp(context.ip),
            action: 'inventory.stock_changed',
            target: `product:${result.product.id}`,
            before: {stock: result.before},
            after: {
              stock: result.after,
              action: value.action,
              units: value.units,
              reason: value.reason,
              note: value.note,
              requestId: value.requestId,
              ...(option ? {optionCreated: option.created} : {}),
              ...(result.option
                ? {option: result.option.label, optionId: result.option.id}
                : {}),
            },
          },
        ],
        {session},
      );
      await InventoryAdjustment.create([{...key, fingerprint: hash, result}], {
        session,
      });
      return result;
    });
  } catch (error) {
    // Includes a racing duplicate and an uncertain commit response.
    const committed = await InventoryAdjustment.findOne(key).lean();
    if (committed) return replay(committed, hash);
    throw error;
  }
}

module.exports = {apply, fingerprint, replay};
