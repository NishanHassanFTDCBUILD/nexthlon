// Store settings the admin can change. Each has a default, so the store works before anything is saved.
const Setting = require("../models/Setting");
const { HttpError } = require("../utils/http");

const DEFAULTS = {
  // Wallet credit (paise) for both people when a new customer signs up with a referral code. 0 turns it off.
  referralReward: 10000
};
const LIMITS = {
  referralReward: { min: 0, max: 100000 }
};

async function get(key) {
  if (!Object.hasOwn(DEFAULTS, key)) throw new Error(`Unknown setting ${key}`);
  const row = await Setting.findOne({ key }).lean();
  return row ? row.value : DEFAULTS[key];
}

async function getAll() {
  const rows = await Setting.find({ key: { $in: Object.keys(DEFAULTS) } }).lean();
  const values = { ...DEFAULTS };
  rows.forEach(row => { values[row.key] = row.value; });
  return values;
}

// Whole paise only, within the limits above.
async function set(key, value) {
  const limit = LIMITS[key];
  if (!limit) throw new HttpError(400, "Unknown setting.");
  if (!Number.isInteger(value) || value < limit.min || value > limit.max) {
    throw new HttpError(400, "That value is out of range.", { [key]: "That value is out of range." });
  }
  await Setting.updateOne({ key }, { $set: { value } }, { upsert: true });
  return getAll();
}

module.exports = { DEFAULTS, LIMITS, get, getAll, set };
