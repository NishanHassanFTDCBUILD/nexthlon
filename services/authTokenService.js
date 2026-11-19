// One-time email links (password reset, email confirmation). See models/AuthToken.js.
const crypto = require('crypto');
const AuthToken = require('../models/AuthToken');

const HOUR = 60 * 60 * 1000;
// How long each kind of link works, and how long its row is kept for counting afterwards.
const LIFETIME_MS = {password_reset: 30 * 60 * 1000, email_verify: 48 * HOUR};
const KEEP_MS = 3 * HOUR;
const PURPOSES = Object.keys(LIFETIME_MS);

// 32 random bytes = 256 bits, 64 hex characters. Not guessable.
const TOKEN = /^[a-f0-9]{64}$/;

const newToken = () => crypto.randomBytes(32).toString('hex');
const hashToken = (raw) =>
  crypto.createHash('sha256').update(String(raw)).digest('hex');

// Makes a link for this person. Older unused links for the same purpose stop working.
// Returns the raw token: it goes into the email and is never stored.
async function issue(user, purpose, {ip = '', sentTo = user.email} = {}) {
  if (!PURPOSES.includes(purpose))
    throw new Error(`Unknown token purpose: ${purpose}`);
  const now = new Date();
  await AuthToken.updateMany(
    {user: user._id, purpose, usedAt: null, supersededAt: null},
    {$set: {supersededAt: now}},
  );
  const raw = newToken();
  await AuthToken.create({
    user: user._id,
    purpose,
    tokenHash: hashToken(raw),
    sentTo,
    ip,
    expiresAt: new Date(now.getTime() + LIFETIME_MS[purpose]),
    deleteAt: new Date(now.getTime() + LIFETIME_MS[purpose] + KEEP_MS),
  });
  return raw;
}

// Uses the link: valid, not yet used, not replaced and not expired. Atomic, so two requests with the
// same link cannot both succeed. Returns the row, or null.
async function consume(raw, purpose) {
  if (typeof raw !== 'string' || !TOKEN.test(raw)) return null;
  const now = new Date();
  return AuthToken.findOneAndUpdate(
    {
      tokenHash: hashToken(raw),
      purpose,
      usedAt: null,
      supersededAt: null,
      expiresAt: {$gt: now},
    },
    {$set: {usedAt: now}},
    {new: true},
  );
}

// Looks at a link without using it (to show "this link has expired" before asking for a password).
async function isUsable(raw, purpose) {
  if (typeof raw !== 'string' || !TOKEN.test(raw)) return false;
  return Boolean(
    await AuthToken.exists({
      tokenHash: hashToken(raw),
      purpose,
      usedAt: null,
      supersededAt: null,
      expiresAt: {$gt: new Date()},
    }),
  );
}

// Links issued for this person and purpose in the last `windowMs` (to limit how many emails one account gets).
function countRecent(userId, purpose, windowMs = HOUR) {
  return AuthToken.countDocuments({
    user: userId,
    purpose,
    createdAt: {$gt: new Date(Date.now() - windowMs)},
  });
}

// Stops every unused link of this kind (after the password is changed, the others must die too).
function invalidateAll(userId, purpose) {
  return AuthToken.updateMany(
    {user: userId, purpose, usedAt: null, supersededAt: null},
    {$set: {supersededAt: new Date()}},
  );
}

module.exports = {
  issue,
  consume,
  isUsable,
  countRecent,
  invalidateAll,
  hashToken,
  newToken,
  TOKEN,
  LIFETIME_MS,
};
