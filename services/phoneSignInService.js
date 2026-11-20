// Sign in or sign up with a code sent to your phone (no password).
//
//   requestCode(phone)            sends a 6-digit code to any valid Indian mobile number. A number with an
//                                 account gets a sign-in code; a new number gets a sign-up code. The answer
//                                 is the same either way, so the page cannot tell which numbers have accounts.
//   verifyCode(phone, code)       { user } when the number has an account, or { ticket } for a new number:
//                                 proof the number was confirmed, good for 15 minutes.
//   createAccount(ticket, data)   makes the account for a confirmed new number (name and email are still
//                                 needed: order emails, invoices and password reset all use the email).
//
// Codes: 5 tries, 10 minutes, 30 s between codes. Blocked accounts get no code and never sign in.
const crypto = require('crypto');
const config = require('../config/env');
const PhoneCode = require('../models/PhoneCode');
const User = require('../models/User');
const messageService = require('./messageService');
const authService = require('./authService');
const logger = require('../utils/logger');
const {HttpError} = require('../utils/http');

const CODE_LIFE_MS = 10 * 60 * 1000;
const RESEND_MS = 30 * 1000;
const TICKET_LIFE_MS = 15 * 60 * 1000;
const MAX_TRIES = 5;
const SAME_ANSWER =
  'We have sent a 6-digit code to your mobile number. It is valid for 10 minutes.';

const hmac = (text) =>
  crypto
    .createHmac('sha256', String(config.jwtSecret))
    .update(text)
    .digest('hex');
const hash = (owner, phone, code) => hmac(`signin:${owner}:${phone}:${code}`);

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

// Which code a number gets: a sign-in code for its account, or a sign-up code with no account.
const codeKey = (user, phone) =>
  user
    ? {user: user._id, phone, purpose: 'signin'}
    : {user: null, phone, purpose: 'signup'};

const invalidPhone = () =>
  new HttpError(400, 'Enter a 10-digit Indian mobile number.', {
    phone: 'Enter a 10-digit Indian mobile number.',
  });

const wrongCode = () =>
  new HttpError(400, 'That code is wrong or has expired. Ask for a new one.', {
    code: 'That code is wrong or has expired.',
  });

async function requestCode(rawPhone, now = new Date()) {
  const phone = messageService.toIndianMobile(rawPhone);
  if (!phone) throw invalidPhone();
  const user = await accountFor(phone);
  if (user && user.isBlocked) return {message: SAME_ANSWER};

  const key = codeKey(user, phone);
  const existing = await PhoneCode.findOne(key);
  if (existing && now - new Date(existing.lastSentAt) < RESEND_MS)
    throw new HttpError(
      429,
      'Please wait 30 seconds before asking for another code.',
    );

  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  await PhoneCode.findOneAndUpdate(
    key,
    {
      $set: {
        ...key,
        codeHash: hash(key.user || 'new', phone, code),
        attempts: 0,
        lastSentAt: now,
        expiresAt: new Date(now.getTime() + CODE_LIFE_MS),
      },
      $inc: {sentCount: 1},
    },
    {upsert: true},
  );
  try {
    await messageService.sendOtp(phone, code);
  } catch (error) {
    logger.warn('signin_otp.failed', {message: error.message});
  }
  return {message: SAME_ANSWER};
}

// A signed note that this number was confirmed: "<phone>.<expires>.<signature>".
function makeTicket(phone, now) {
  const expires = now.getTime() + TICKET_LIFE_MS;
  return `${phone}.${expires}.${hmac(`phone-signup:${phone}:${expires}`)}`;
}

function readTicket(ticket, now = new Date()) {
  const [phone, expires, signature] = String(ticket || '').split('.');
  const good =
    /^91[6-9][0-9]{9}$/.test(phone || '') &&
    /^[0-9]+$/.test(expires || '') &&
    Number(expires) > now.getTime() &&
    typeof signature === 'string' &&
    signature.length === 64 &&
    crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(hmac(`phone-signup:${phone}:${expires}`)),
    );
  if (!good)
    throw new HttpError(
      400,
      'Your phone confirmation has expired. Ask for a new code.',
    );
  return phone;
}

async function verifyCode(rawPhone, code, now = new Date()) {
  const phone = messageService.toIndianMobile(rawPhone);
  if (!phone || !/^[0-9]{6}$/.test(String(code || ''))) throw wrongCode();
  const user = await accountFor(phone);
  if (user && user.isBlocked) throw wrongCode();
  const key = codeKey(user, phone);
  const record = await PhoneCode.findOne(key);
  if (!record || record.expiresAt <= now) throw wrongCode();
  if (record.attempts >= MAX_TRIES)
    throw new HttpError(400, 'Too many wrong codes. Ask for a new one.', {
      code: 'Too many wrong codes. Ask for a new one.',
    });
  if (record.codeHash !== hash(key.user || 'new', phone, String(code))) {
    await PhoneCode.updateOne({_id: record._id}, {$inc: {attempts: 1}});
    throw wrongCode();
  }
  await PhoneCode.deleteOne({_id: record._id});
  if (user) return {user: await User.findById(user._id)};
  return {ticket: makeTicket(phone, now)};
}

// Makes the account for a number confirmed by verifyCode. The email must be new: an existing email
// account signs in with its password (or Google) and adds the number in My Account.
async function createAccount(
  ticket,
  {name, email, referralCode},
  now = new Date(),
) {
  const phone = readTicket(ticket, now);
  if (await accountFor(phone))
    throw new HttpError(
      409,
      'This number already has an account. Sign in with a code instead.',
    );
  const user = await authService.registerCustomer({
    name,
    email,
    // No password: a long random one nobody knows. "Forgot password" sets a real one later.
    password: crypto.randomBytes(32).toString('hex'),
    referralCode,
  });
  user.phone = phone.slice(-10);
  await user.save();
  return user;
}

module.exports = {
  requestCode,
  verifyCode,
  createAccount,
  readTicket,
  SAME_ANSWER,
};
