// Store settings the admin can change. Each has a default, so the store works before anything is saved.
const Setting = require('../models/Setting');
const {COD_LIMIT} = require('../utils/orderRules');
const {HttpError} = require('../utils/http');

const DEFAULTS = {
  // Wallet credit (paise) for both people when a new customer signs up with a referral code. 0 turns it off.
  referralReward: 10000,
  // Cash on Delivery is offered for order totals up to this amount (paise). 0 turns it off.
  codLimit: COD_LIMIT,
  // E2: percent off for paying online (UPI, cards, netbanking), 0 = off, and the most it can take off (paise, 0 = no cap).
  prepaidPercent: 0,
  prepaidMax: 10000,
  // E2: 1 = a Cash on Delivery order needs a code sent to the delivery phone (first time per phone in 90 days).
};
const LIMITS = {
  referralReward: {min: 0, max: 100000},
  codLimit: {min: 0, max: 5000000},
  prepaidPercent: {min: 0, max: 10},
  prepaidMax: {min: 0, max: 100000},
};

async function get(key) {
  if (!Object.hasOwn(DEFAULTS, key)) throw new Error(`Unknown setting ${key}`);
  const row = await Setting.findOne({key}).lean();
  return row ? row.value : DEFAULTS[key];
}

async function getAll() {
  const rows = await Setting.find({key: {$in: Object.keys(DEFAULTS)}}).lean();
  const values = {...DEFAULTS};
  rows.forEach((row) => {
    values[row.key] = row.value;
  });
  return values;
}

// Whole paise only, within the limits above.
async function set(key, value) {
  const limit = LIMITS[key];
  if (!limit) throw new HttpError(400, 'Unknown setting.');
  if (!Number.isInteger(value) || value < limit.min || value > limit.max) {
    throw new HttpError(400, 'That value is out of range.', {
      [key]: 'That value is out of range.',
    });
  }
  await Setting.updateOne({key}, {$set: {value}}, {upsert: true});
  return getAll();
}

// Whether Cash on Delivery can be offered for this amount (paise) under the given limit.
function codAllowedFor(amount, limit) {
  return limit > 0 && amount > 0 && amount <= limit;
}

module.exports = {DEFAULTS, LIMITS, get, getAll, set, codAllowedFor};
