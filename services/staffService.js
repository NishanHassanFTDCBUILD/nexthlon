// Staff accounts for the admin console: who has access, what role they have, and turning access
// on or off. Every change is audit-logged by the controller. Roles are defined in utils/permissions.js.
//
// Creating an account gives a temporary password, shown to the owner once. The person signs in
// with it and should change it (the password screen is in My Account).
const crypto = require('crypto');
const mongoose = require('mongoose');
const User = require('../models/User');
const {hashPassword} = require('./authService');
const {ROLES, ROLE_LABELS} = require('../utils/permissions');
const {HttpError} = require('../utils/http');

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const toStaff = (u, now = new Date()) => ({
  id: String(u._id),
  name: u.name,
  email: u.email,
  role: ROLES.includes(u.adminRole) ? u.adminRole : 'owner',
  roleLabel: ROLE_LABELS[ROLES.includes(u.adminRole) ? u.adminRole : 'owner'],
  active: !u.isBlocked,
  lastSignInAt: u.lastLoginAt || null,
  neverSignedIn: !u.lastLoginAt,
  createdAt: u.createdAt,
  isNew: u.createdAt && now - new Date(u.createdAt) < 24 * 60 * 60 * 1000,
});

// Every admin account (customers are not listed here).
async function list() {
  const rows = await User.find({role: 'admin', isDeleted: {$ne: true}})
    .sort({createdAt: 1})
    .limit(200)
    .lean();
  return rows.map((u) => toStaff(u));
}

function readName(name) {
  const clean = String(name || '')
    .trim()
    .replace(/\s+/g, ' ');
  if (clean.length < 2 || clean.length > 60)
    throw new HttpError(400, 'Enter a name of 2 to 60 characters.', {
      name: 'Enter a name of 2 to 60 characters.',
    });
  return clean;
}

function readRole(role) {
  if (!ROLES.includes(role))
    throw new HttpError(400, 'Choose a role.', {role: 'Choose a role.'});
  return role;
}

// A strong temporary password: 14 characters with letters and digits, no look-alikes.
function temporaryPassword() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(14);
  let out = '';
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  return out;
}

async function create({name, email, role}) {
  const cleanEmail = String(email || '')
    .trim()
    .toLowerCase();
  if (!EMAIL.test(cleanEmail))
    throw new HttpError(400, 'Enter an email address.', {
      email: 'Enter an email address.',
    });
  const cleanName = readName(name);
  const cleanRole = readRole(role);
  if (await User.exists({email: cleanEmail}))
    throw new HttpError(409, 'An account with this email already exists.', {
      email: 'An account with this email already exists.',
    });
  const password = temporaryPassword();
  const user = await User.create({
    name: cleanName,
    email: cleanEmail,
    passwordHash: await hashPassword(password),
    role: 'admin',
    adminRole: cleanRole,
  });
  return {staff: toStaff(user.toObject()), temporaryPassword: password};
}

// Refuses changes that would lock the store out: the last active owner cannot be demoted or
// switched off, and nobody changes their own access here.
async function guard(staffId, actorId) {
  if (!mongoose.isValidObjectId(staffId))
    throw new HttpError(404, 'Staff account not found.');
  const user = await User.findOne({_id: staffId, role: 'admin'});
  if (!user) throw new HttpError(404, 'Staff account not found.');
  if (String(user._id) === String(actorId))
    throw new HttpError(409, 'You cannot change your own access here.');
  return user;
}

async function activeOwners() {
  return User.countDocuments({
    role: 'admin',
    isDeleted: {$ne: true},
    isBlocked: false,
    adminRole: {$in: ['owner', '']},
  });
}

async function setRole(staffId, role, actorId) {
  const user = await guard(staffId, actorId);
  const next = readRole(role);
  const wasOwner = !user.adminRole || user.adminRole === 'owner';
  if (wasOwner && next !== 'owner' && !user.isBlocked) {
    if ((await activeOwners()) <= 1)
      throw new HttpError(409, 'Keep at least one active owner.');
  }
  const before = user.adminRole || 'owner';
  user.adminRole = next;
  await user.save();
  return {before, staff: toStaff(user.toObject())};
}

async function setActive(staffId, active, actorId) {
  const user = await guard(staffId, actorId);
  if (!active && (!user.adminRole || user.adminRole === 'owner')) {
    if ((await activeOwners()) <= 1)
      throw new HttpError(409, 'Keep at least one active owner.');
  }
  user.isBlocked = !active;
  // Signing out everywhere: every token issued before this change stops working.
  if (!active) user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();
  return toStaff(user.toObject());
}

module.exports = {list, create, setRole, setActive, toStaff, temporaryPassword};
