// Refresh tokens: the long-lived half of the login.
//
// A refresh token is a random string, not a JWT. It carries no information at all, so there is
// nothing to read inside it; its only job is to point at one row in the refreshtokens collection.
// That row is what makes it revocable, which a JWT can never be.
//
// Rotation: every renewal issues a NEW token and revokes the old one. So a token is valid exactly
// once. If an already-used token turns up again, two copies exist, which means one was stolen —
// so the whole family (every token from that sign-in) is revoked at once.
//
// One exception, the grace window: two tabs (or a phone waking up) often renew at the same moment,
// and the slower request arrives carrying a token the faster one has just replaced. That is the same
// browser, not a thief, so for REUSE_GRACE_MS after a rotation the old token is answered with a fresh
// ACCESS token only (never a new refresh token) and the family is left alone. The browser already
// holds the new refresh cookie from the faster request. Replayed later, it still revokes the family.
const crypto = require('crypto');
const mongoose = require('mongoose');
const RefreshToken = require('../models/RefreshToken');
const config = require('../config/env');
const auditService = require('./auditService');
const logger = require('../utils/logger');
const {browserName} = require('../utils/device');

// 32 random bytes = 256 bits of entropy, written as 64 hex characters. Not guessable.
const TOKEN_BYTES = 32;
// How long after a rotation the replaced token is still treated as "the same browser, a moment later".
// Long enough for a slow phone connection, short enough that a stolen copy is useless soon after.
const REUSE_GRACE_MS = 20_000;

function newToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString('hex');
}

// Only the hash is ever stored. SHA-256 is right here (unlike for passwords, which need bcrypt):
// the token is already long and random, so there is nothing to brute-force.
function hashToken(rawToken) {
  return crypto.createHash('sha256').update(String(rawToken)).digest('hex');
}

function lifetimeMs(role) {
  return role === 'admin'
    ? config.adminRefreshExpiresInMs
    : config.refreshExpiresInMs;
}

// Details of the device that is signing in, for the "Logged-in devices" list.
function deviceFrom(req) {
  return {
    device: browserName(req && req.get ? req.get('user-agent') : ''),
    ip: auditService.maskIp(req ? req.ip : ''),
  };
}

// ---------- Issuing ----------

// A new sign-in starts a new family; a renewal keeps the family it was given.
async function issue(
  user,
  {familyId = crypto.randomUUID(), device = '', ip = ''} = {},
) {
  const rawToken = newToken();
  const role = user.role === 'admin' ? 'admin' : 'customer';
  const record = await RefreshToken.create({
    user: user._id,
    role,
    tokenHash: hashToken(rawToken),
    familyId,
    expiresAt: new Date(Date.now() + lifetimeMs(role)),
    device: device || 'Unknown browser',
    ip,
  });
  return {rawToken, familyId, record};
}

// ---------- Revoking ----------

function revokeRecord(record, reason, replacedBy = null) {
  return RefreshToken.updateOne(
    {_id: record._id, revoked: false},
    {
      $set: {
        revoked: true,
        revokedAt: new Date(),
        revokedReason: reason,
        replacedBy,
      },
    },
  );
}

// Signing out one device: the token the browser just sent stops working.
async function revokeToken(rawToken, reason = 'logout') {
  if (!rawToken) return 0;
  const result = await RefreshToken.updateOne(
    {tokenHash: hashToken(rawToken), revoked: false},
    {$set: {revoked: true, revokedAt: new Date(), revokedReason: reason}},
  );
  return result.modifiedCount || 0;
}

// Stolen-token detection, and signing out one device: one sign-in's whole chain of tokens is
// killed. Pass userId to make sure the family really belongs to that account.
async function revokeFamily(familyId, reason = 'reuse', userId = null) {
  if (!familyId) return 0;
  const filter = {familyId, revoked: false};
  if (userId) filter.user = userId;
  const result = await RefreshToken.updateMany(filter, {
    $set: {revoked: true, revokedAt: new Date(), revokedReason: reason},
  });
  return result.modifiedCount || 0;
}

// Password change, blocking, "log out of all devices", deleting the account: every device goes.
async function revokeAllForUser(userId, reason = 'logout_all') {
  const result = await RefreshToken.updateMany(
    {user: userId, revoked: false},
    {$set: {revoked: true, revokedAt: new Date(), revokedReason: reason}},
  );
  return result.modifiedCount || 0;
}

// ---------- Renewing (rotation) ----------

// Is this revoked token only a moment old, replaced by a token that is still good, for a live account?
// Returns the user when it is a concurrent renewal from the same browser, otherwise null.
async function concurrentRenewalUser(record, role) {
  if (
    record.revokedReason !== 'rotated' ||
    !record.revokedAt ||
    record.role !== role
  )
    return null;
  if (Date.now() - record.revokedAt.getTime() > REUSE_GRACE_MS) return null;
  const user = record.user;
  if (!user || user.isDeleted || user.isBlocked || user.role !== role)
    return null;
  // The token that replaced it must still be alive. A logout, a password change or a reuse alarm
  // revokes it for another reason, and then nothing in this family may renew anything.
  if (record.replacedBy) {
    const successor = await RefreshToken.findById(record.replacedBy)
      .select('revoked revokedReason expiresAt')
      .lean();
    if (!successor || successor.expiresAt.getTime() <= Date.now()) return null;
    if (successor.revoked && successor.revokedReason !== 'rotated') return null;
  }
  return user;
}

// Checks the token the browser sent and swaps it for a fresh one.
// Returns { ok: true, user, rawToken, familyId }, or { ok: true, concurrent: true, user } when the
// token was replaced an instant ago by a renewal from the same browser (no new refresh token is
// issued, see the grace window above), or { ok: false, reason } where reason is
// "missing" | "unknown" | "expired" | "reuse" | "wrong_session" | "account".
// "reuse" also means the whole family has just been revoked.
async function rotate(
  rawToken,
  {role = 'customer', device = '', ip = ''} = {},
) {
  if (!rawToken) return {ok: false, reason: 'missing'};

  const record = await RefreshToken.findOne({
    tokenHash: hashToken(rawToken),
  }).populate('user');
  if (!record) return {ok: false, reason: 'unknown'};

  // An already-used (or already-revoked) token came back. A moment after a rotation it is most likely
  // another tab of the same browser; any later, someone has a copy of it.
  if (record.revoked) {
    const concurrentUser = await concurrentRenewalUser(record, role);
    if (concurrentUser) {
      logger.info('refresh.concurrent', {
        user: String(concurrentUser._id),
        family: record.familyId,
      });
      return {ok: true, concurrent: true, user: concurrentUser};
    }
    const killed = await revokeFamily(record.familyId, 'reuse');
    logger.warn('refresh.reuse_detected', {
      user: String(record.user && record.user._id),
      family: record.familyId,
      revoked: killed,
    });
    await auditService.record({
      actor: record.user && record.user._id,
      actorRole: record.role,
      action: 'auth.refresh_reuse',
      target: `user:${record.user ? record.user._id : 'unknown'}`,
      after: {familyId: record.familyId, revoked: killed},
      ip,
    });
    return {ok: false, reason: 'reuse'};
  }

  if (record.expiresAt.getTime() <= Date.now()) {
    await revokeRecord(record, 'expired');
    return {ok: false, reason: 'expired'};
  }

  // A store token must never renew an admin session, or the other way round.
  if (record.role !== role) return {ok: false, reason: 'wrong_session'};

  const user = record.user;
  if (!user || user.isDeleted || user.isBlocked || user.role !== role) {
    await revokeRecord(record, 'account');
    return {ok: false, reason: 'account'};
  }

  // Rotate. First CLAIM the old token in one atomic step, so that of several renewals arriving at the
  // same instant exactly one wins and issues the new token; the others find it already claimed.
  const claimed = await RefreshToken.findOneAndUpdate(
    {_id: record._id, revoked: false},
    {$set: {revoked: true, revokedAt: new Date(), revokedReason: 'rotated'}},
  );
  if (!claimed) return rotate(rawToken, {role, device, ip}); // lost the race: now takes the grace path

  // The new token joins the same family, and the old row points at its replacement.
  let next;
  try {
    next = await issue(user, {
      familyId: record.familyId,
      device: device || record.device,
      ip: ip || record.ip,
    });
  } catch (error) {
    // Nothing replaced it, so give the old token back rather than sign the customer out over a hiccup.
    await RefreshToken.updateOne(
      {_id: record._id, replacedBy: null, revokedReason: 'rotated'},
      {$set: {revoked: false, revokedAt: null, revokedReason: ''}},
    );
    throw error;
  }
  await RefreshToken.updateOne(
    {_id: record._id},
    {$set: {replacedBy: next.record._id}},
  );
  await RefreshToken.updateOne(
    {_id: next.record._id},
    {$set: {lastUsedAt: new Date()}},
  );
  return {ok: true, user, rawToken: next.rawToken, familyId: record.familyId};
}

// ---------- The "Logged-in devices" list ----------

// Every live session of this account, newest first. currentFamilyId comes from the nx_sid cookie
// and only decides which row is labelled "this device".
async function listSessions(userId, currentFamilyId = '') {
  const rows = await RefreshToken.find({
    user: userId,
    revoked: false,
    expiresAt: {$gt: new Date()},
  })
    .sort({createdAt: -1})
    .select('familyId device ip createdAt lastUsedAt expiresAt role')
    .lean();
  return rows.map((row) => ({
    id: String(row._id),
    device: row.device,
    ip: row.ip,
    role: row.role,
    signedInAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    expiresAt: row.expiresAt,
    current: Boolean(currentFamilyId) && row.familyId === currentFamilyId,
  }));
}

// "Log out this device". The id must belong to this account, so one customer can never end
// another customer's session. Returns whether the device logged out was this one.
async function revokeSession(userId, sessionId, currentFamilyId = '') {
  if (!mongoose.isValidObjectId(sessionId)) return null;
  const record = await RefreshToken.findOne({_id: sessionId, user: userId});
  if (!record) return null;
  await revokeFamily(record.familyId, 'device_logout', userId);
  return {
    current: Boolean(currentFamilyId) && record.familyId === currentFamilyId,
    device: record.device,
  };
}

module.exports = {
  REUSE_GRACE_MS,
  newToken,
  hashToken,
  lifetimeMs,
  deviceFrom,
  issue,
  rotate,
  revokeToken,
  revokeFamily,
  revokeAllForUser,
  listSessions,
  revokeSession,
};
