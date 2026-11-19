// Referrals. Every customer has a code. A NEW customer who signs up with someone's code gets
// wallet credit, and so does the friend who invited them, once the new customer's first order is delivered. The amount is a store setting the
// admin can change. It happens once per new customer: both credits carry a unique key.
const crypto = require('crypto');
const User = require('../models/User');
const walletService = require('./walletService');
const settingsService = require('./settingsService');
const {HttpError} = require('../utils/http');
const logger = require('../utils/logger');

const CODE = /^[A-Z0-9]{6,12}$/;
// The random part has no 0/O or 1/I, so a code typed from a screenshot is never ambiguous.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// Up to 4 letters of the name, then random characters, 8 in all: ASHA7K2P.
function makeCode(name = '', random = crypto.randomBytes(8)) {
  let code =
    String(name)
      .toUpperCase()
      .replace(/[^A-Z]/g, '')
      .slice(0, 4) || 'NX';
  for (let i = 0; code.length < 8; i += 1)
    code += ALPHABET[random[i] % ALPHABET.length];
  return code;
}

function normaliseCode(raw) {
  return typeof raw === 'string' ? raw.replace(/\s+/g, '').toUpperCase() : '';
}

// Gives the user a code if they do not have one yet. Retries if a code is already taken.
async function ensureCode(user) {
  if (user.referralCode) return user.referralCode;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = makeCode(user.name);
    try {
      const updated = await User.findOneAndUpdate(
        {_id: user._id, referralCode: {$exists: false}},
        {$set: {referralCode: code}},
        {new: true},
      );
      if (updated) {
        user.referralCode = updated.referralCode;
        return updated.referralCode;
      }
      const fresh = await User.findById(user._id).select('referralCode').lean();
      if (fresh && fresh.referralCode) {
        user.referralCode = fresh.referralCode;
        return fresh.referralCode;
      }
    } catch (error) {
      if (error.code !== 11000) throw error;
    }
  }
  throw new Error(
    "We couldn't make your invite code just now. Refresh the page to try again.",
  );
}

// Finds the customer who owns this code, for sign-up. Throws a field error for a bad code.
async function findReferrer(rawCode) {
  const code = normaliseCode(rawCode);
  if (!code) return null;
  const referrer = CODE.test(code)
    ? await User.findOne({referralCode: code, role: 'customer'})
        .select('_id name isBlocked')
        .lean()
    : null;
  if (!referrer || referrer.isBlocked) {
    throw new HttpError(400, 'This referral code is not valid.', {
      referralCode:
        'This referral code is not valid. Check it, or leave it empty.',
    });
  }
  return referrer;
}

// A sign-up with a code only RECORDS the invite (User.referredBy). The reward waits for the new customer's
// first delivered order (rewardOnDelivery), so made-up accounts cannot collect wallet money (D3).
// Returns the reward the two will get, for the welcome message.
async function rewardSignup(newUser, referrer) {
  if (!referrer) return {reward: 0, pending: false};
  const reward = await settingsService.get('referralReward');
  return {reward: reward > 0 ? reward : 0, pending: reward > 0};
}

// Called when an order is delivered. If its customer joined with a code and this is their first
// delivered order, both get the reward. Safe to call for every delivery: the wallet keys allow one
// credit per new customer, ever. A blocked or deleted inviter gets nothing; the new customer still does.
async function rewardOnDelivery(userId) {
  const user = await User.findById(userId).select('name referredBy').lean();
  if (!user || !user.referredBy) return {reward: 0};
  const reward = await settingsService.get('referralReward');
  if (!(reward > 0)) return {reward: 0};
  const firstName = String(user.name).split(' ')[0];
  await walletService.credit(user._id, reward, {
    kind: 'referral',
    reason:
      'Welcome bonus: your first order with a referral code was delivered',
    key: `referral:joined:${user._id}`,
  });
  const referrer = await User.findOne({_id: user.referredBy, role: 'customer'})
    .select('_id isBlocked')
    .lean();
  if (referrer && !referrer.isBlocked) {
    await walletService.credit(referrer._id, reward, {
      kind: 'referral',
      reason: `Referral bonus: ${firstName}'s first order was delivered`,
      key: `referral:invited:${user._id}`,
    });
  }
  logger.info('referral.rewarded', {
    user: String(user._id),
    referrer: String(user.referredBy),
    reward,
  });
  return {reward};
}

// What the wallet page shows: the code, a share link, the reward and how many friends joined.
async function getReferral(user, baseUrl = '') {
  const code = await ensureCode(user);
  const [reward, joined] = await Promise.all([
    settingsService.get('referralReward'),
    User.countDocuments({referredBy: user._id}),
  ]);
  return {code, link: `${baseUrl}/signup?ref=${code}`, reward, joined};
}

// Older accounts made before referrals existed get a code.
async function migrateCodes() {
  const users = await User.find({
    role: 'customer',
    referralCode: {$exists: false},
  })
    .select('_id name')
    .limit(5000);
  for (const user of users) await ensureCode(user);
  return users.length;
}

module.exports = {
  CODE,
  makeCode,
  normaliseCode,
  ensureCode,
  findReferrer,
  rewardSignup,
  rewardOnDelivery,
  getReferral,
  migrateCodes,
};
