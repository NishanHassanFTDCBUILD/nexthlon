// Return rules as the admin sets them: the automatic-approval limit and the owner-approval limit,
// both in rupees on the form and in paise in the database (one Setting per limit, 0 = off).
const Setting = require('../models/Setting');
const {MAX_LIMIT} = require('../utils/returnRules');
const {HttpError} = require('../utils/http');

const KEYS = {
  autoApproveUnder: 'returns:autoApproveUnder',
  ownerApprovalAbove: 'returns:ownerApprovalAbove',
};

async function rules() {
  const rows = await Setting.find({key: {$in: Object.values(KEYS)}}).lean();
  const byKey = Object.fromEntries(
    rows.map((row) => [row.key, Number(row.value)]),
  );
  return {
    autoApproveUnder: byKey[KEYS.autoApproveUnder] || 0,
    ownerApprovalAbove: byKey[KEYS.ownerApprovalAbove] || 0,
  };
}

const MESSAGE = 'Enter a whole number of rupees from 0 to 1 crore.';

// Parses one rupee field into paise. Blank means off (0).
function paiseFrom(value, field, errors) {
  const rupees =
    value === '' || value === undefined || value === null ? 0 : Number(value);
  if (!Number.isInteger(rupees) || rupees < 0 || rupees * 100 > MAX_LIMIT) {
    errors[field] = MESSAGE;
    return 0;
  }
  return rupees * 100;
}

// Saves both limits in one go. Returns the old and new limits, in paise.
async function setRules({autoApproveRupees, ownerApproveRupees} = {}) {
  const errors = {};
  const autoApproveUnder = paiseFrom(
    autoApproveRupees,
    'autoApproveRupees',
    errors,
  );
  const ownerApprovalAbove = paiseFrom(
    ownerApproveRupees,
    'ownerApproveRupees',
    errors,
  );
  if (Object.keys(errors).length)
    throw new HttpError(400, 'Check the return rule amounts.', errors);
  if (ownerApprovalAbove && autoApproveUnder > ownerApprovalAbove)
    throw new HttpError(
      400,
      'Automatic approval cannot go above the owner approval limit.',
      {autoApproveRupees: 'This is above the owner approval limit.'},
    );
  const before = await rules();
  await Promise.all([
    Setting.updateOne(
      {key: KEYS.autoApproveUnder},
      {$set: {value: autoApproveUnder}},
      {upsert: true},
    ),
    Setting.updateOne(
      {key: KEYS.ownerApprovalAbove},
      {$set: {value: ownerApprovalAbove}},
      {upsert: true},
    ),
  ]);
  return {before, after: {autoApproveUnder, ownerApprovalAbove}};
}

module.exports = {rules, setRules, KEYS};
