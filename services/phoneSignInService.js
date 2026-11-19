// Sign in with a code sent to your phone (no password). It works for accounts that already have a
// mobile number on them. New accounts still sign up by email, so a phone-only account never needs
// an email address faked.
//
//   requestCode(phone)        sends a 6-digit code, but only when an active account has this number.
//                             The answer is the same either way, so the page cannot tell which numbers
//                             have accounts.
//   verifyCode(phone, code)   returns the account when the code is right (5 tries, 10 minutes, 30 s between codes)
const crypto = require('crypto');
const config = require('../config/env');
const PhoneCode = require('../models/PhoneCode');
const User = require('../models/User');
const messageService = require('./messageService');
const logger = require('../utils/logger');
const {HttpError} = require('../utils/http');

const CODE_LIFE_MS = 10 * 60 * 1000;
const RESEND_MS = 30 * 1000;
const MAX_TRIES = 5;
const PURPOSE = 'signin';
const SAME_ANSWER =
  'If this number belongs to an account, we have sent a code to it. It is valid for 10 minutes.';

const hash = (userId, phone, code) =>
  crypto
    .createHmac('sha256', String(config.jwtSecret))
    .update(`signin:${userId}:${phone}:${code}`)
    .digest('hex');

// The forms a number can be stored in on an account.
function storedForms(phone) {
  const ten = phone.slice(-10);
  return [ten, `+91${ten}`, `91${ten}`, `0${ten}`];
}

async function accountFor(phone) {
  return User.findOne({
    role: 'customer',
    phone: {$in: storedForms(phone)},
  })
    .select('name isBlocked phone')
    .lean();
}

const invalidPhone = () =>
  new HttpError(400, 'Enter a 10-digit Indian mobile number.', {
    phone: 'Enter a 10-digit Indian mobile number.',
  });

async function requestCode(rawPhone, now = new Date()) {
  const phone = messageService.toIndianMobile(rawPhone);
  if (!phone) throw invalidPhone();
  const user = await accountFor(phone);
  if (!user || user.isBlocked) return {message: SAME_ANSWER};

  const existing = await PhoneCode.findOne({
    user: user._id,
    phone,
    purpose: PURPOSE,
  });
  if (existing && now - new Date(existing.lastSentAt) < RESEND_MS)
    throw new HttpError(
      429,
      'Please wait 30 seconds before asking for another code.',
    );

  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const record = {
    user: user._id,
    phone,
    purpose: PURPOSE,
    codeHash: hash(user._id, phone, code),
    attempts: 0,
    lastSentAt: now,
    expiresAt: new Date(now.getTime() + CODE_LIFE_MS),
  };
  await PhoneCode.findOneAndUpdate(
    {user: user._id, phone, purpose: PURPOSE},
    {$set: record, $inc: {sentCount: 1}},
    {upsert: true},
  );
  try {
    await messageService.sendOtp(phone, code);
  } catch (error) {
    logger.warn('signin_otp.failed', {message: error.message});
  }
  return {message: SAME_ANSWER};
}

async function verifyCode(rawPhone, code, now = new Date()) {
  const phone = messageService.toIndianMobile(rawPhone);
  const wrong = () =>
    new HttpError(
      400,
      'That code is wrong or has expired. Ask for a new one.',
      {
        code: 'That code is wrong or has expired.',
      },
    );
  if (!phone || !/^[0-9]{6}$/.test(String(code || ''))) throw wrong();
  const user = await accountFor(phone);
  if (!user || user.isBlocked) throw wrong();
  const record = await PhoneCode.findOne({
    user: user._id,
    phone,
    purpose: PURPOSE,
  });
  if (!record || record.expiresAt <= now) throw wrong();
  if (record.attempts >= MAX_TRIES)
    throw new HttpError(400, 'Too many wrong codes. Ask for a new one.', {
      code: 'Too many wrong codes. Ask for a new one.',
    });
  if (record.codeHash !== hash(user._id, phone, String(code))) {
    await PhoneCode.updateOne({_id: record._id}, {$inc: {attempts: 1}});
    throw wrong();
  }
  await PhoneCode.deleteOne({_id: record._id});
  return User.findById(user._id);
}

module.exports = {requestCode, verifyCode, SAME_ANSWER};
