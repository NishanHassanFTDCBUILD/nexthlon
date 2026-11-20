// The account behind "Continue with Google" or "Continue with Facebook": the one with this (already
// confirmed) email, or a new customer account. A staff or blocked account is never signed in this way.
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const User = require('../models/User');
const referralService = require('./referralService');
const {HttpError} = require('../utils/http');

async function accountForEmail({email, name}) {
  const existing = await User.findOne({email});
  if (existing) {
    if (existing.role !== 'customer')
      throw new HttpError(403, 'This account cannot sign in to the store.');
    if (existing.isBlocked)
      throw new HttpError(403, 'Your account has been blocked.');
    if (!existing.emailVerifiedAt) {
      existing.emailVerifiedAt = new Date();
      await existing.save();
    }
    return existing;
  }
  // A new account with no password: a long random one nobody knows. "Forgot password" sets a real one.
  const passwordHash = await bcrypt.hash(
    crypto.randomBytes(32).toString('hex'),
    10,
  );
  return User.create({
    name,
    email,
    passwordHash,
    role: 'customer',
    emailVerifiedAt: new Date(),
    referralCode: referralService.makeCode(name),
  });
}

module.exports = {accountForEmail};
