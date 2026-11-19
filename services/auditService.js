const mongoose = require('mongoose');
const AuditLog = require('../models/AuditLog');
const logger = require('../utils/logger');

// Field names that must never be written to the audit log.
const SECRET_FIELD = /password|token|secret|hash|otp|signature|card|cvv/i;
const PAGE_SIZE = 25;

// Drops secret fields from a before/after snapshot (one level deep is all we ever store).
function clean(snapshot) {
  if (snapshot === undefined || snapshot === null) return null;
  if (typeof snapshot !== 'object') return snapshot;
  return Object.fromEntries(
    Object.entries(snapshot).filter(([key]) => !SECRET_FIELD.test(key)),
  );
}

// "103.21.244.17" -> "103.21.x.x"; IPv6 keeps its first two groups. Enough to recognise a network,
// not enough to identify a person.
function maskIp(ip) {
  const raw = String(ip || '')
    .trim()
    .replace(/^::ffff:/i, '');
  if (!raw) return '';
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(raw)) {
    const parts = raw.split('.');
    return `${parts[0]}.${parts[1]}.x.x`;
  }
  if (raw.includes(':')) {
    const groups = raw.split(':').filter(Boolean);
    return `${groups.slice(0, 2).join(':') || '::'}:…`;
  }
  return '';
}

// Who did it and from where, read from the request.
function fromRequest(req) {
  const user = req && req.user;
  return {
    actor: user ? user._id : null,
    actorRole: user ? user.role : 'system',
    ip: req ? req.ip : '',
  };
}

// Writing the audit log never breaks the action itself; a failure is logged instead.
async function record({
  actor = null,
  actorRole = 'system',
  action,
  target = '',
  before = null,
  after = null,
  ip = '',
}) {
  try {
    await AuditLog.create({
      actor,
      actorRole,
      action,
      target: String(target).slice(0, 120),
      before: clean(before),
      after: clean(after),
      ip: maskIp(ip),
    });
  } catch (error) {
    logger.error('audit.write_failed', {action, error});
  }
}

// Filters: who (actor id), what (action), and the record it touched (target, e.g. product:<id>).
async function list({actor = '', action = '', target = '', page = 1} = {}) {
  const filter = {};
  if (mongoose.isValidObjectId(actor)) filter.actor = actor;
  if (/^[a-z_.]{2,60}$/.test(action)) filter.action = action;
  if (/^[a-z]{2,20}:[a-f0-9]{24}$/.test(target)) filter.target = target;
  const current = Math.max(1, Number.parseInt(page, 10) || 1);
  const [entries, total] = await Promise.all([
    AuditLog.find(filter)
      .sort({at: -1, _id: -1})
      .skip((current - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .populate('actor', 'name email role')
      .lean(),
    AuditLog.countDocuments(filter),
  ]);
  return {
    entries,
    pagination: {
      page: current,
      pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
      total,
      limit: PAGE_SIZE,
    },
  };
}

module.exports = {clean, maskIp, fromRequest, record, list, SECRET_FIELD};
