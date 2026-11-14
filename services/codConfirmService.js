// Cash on Delivery confirmation by code (E2). Fake or careless COD orders come back as refused parcels
// and cost two courier trips; a code sent to the delivery phone proves someone real is waiting for it.
//
//   isNeeded(user, phone)   the admin turned it on (Settings), a provider can send codes, and this phone
//                           was not confirmed by this customer in the last 90 days
//   send(user, address)     a 6-digit code to the address's phone (SMS, else WhatsApp); 30 s between sends,
//                           5 sends per code
//   verify(user, phone, c)  5 tries; a right code marks the phone as confirmed
const crypto = require("crypto");
const config = require("../config/env");
const PhoneCode = require("../models/PhoneCode");
const User = require("../models/User");
const settingsService = require("./settingsService");
const messageService = require("./messageService");
const logger = require("../utils/logger");
const { HttpError } = require("../utils/http");

const CODE_LIFE_MS = 10 * 60 * 1000;
const RESEND_MS = 30 * 1000;
const MAX_SENDS = 5;
const MAX_TRIES = 5;
const TRUST_MS = 90 * 24 * 60 * 60 * 1000;

const hash = (userId, phone, code) => crypto.createHmac("sha256", String(config.jwtSecret)).update(`cod:${userId}:${phone}:${code}`).digest("hex");
const maskPhone = phone => `+91 ${phone.slice(2, 4)}******${phone.slice(-2)}`;

async function isNeeded(userId, rawPhone, now = new Date()) {
  if (!(await settingsService.get("codOtp"))) return false;
  if (!messageService.canSendCodes()) {
    logger.warn("cod_otp.no_provider", {});
    return false;
  }
  const phone = messageService.toIndianMobile(rawPhone);
  if (!phone) return true;
  const user = await User.findById(userId).select("+verifiedPhones").lean();
  const seen = (user && user.verifiedPhones || []).find(row => row.phone === phone);
  return !(seen && now - new Date(seen.at) < TRUST_MS);
}

async function send(userId, rawPhone, now = new Date()) {
  const phone = messageService.toIndianMobile(rawPhone);
  if (!phone) throw new HttpError(400, "The phone on this address is not an Indian mobile number. Edit the address to use a mobile, or pay online.", null, "cod_phone_invalid");
  const existing = await PhoneCode.findOne({ user: userId, phone, purpose: "cod" });
  if (existing && existing.expiresAt > now) {
    if (now - existing.lastSentAt < RESEND_MS) throw new HttpError(429, "A code was just sent. Wait a few seconds before asking again.", null, "cod_code_wait");
    if (existing.sentCount >= MAX_SENDS) throw new HttpError(429, "Too many codes for this phone. Try again in 10 minutes, or pay online.", null, "cod_code_limit");
  }
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  await PhoneCode.updateOne(
    { user: userId, phone, purpose: "cod" },
    {
      $set: { codeHash: hash(userId, phone, code), attempts: 0, lastSentAt: now, expiresAt: new Date(now.getTime() + CODE_LIFE_MS) },
      $inc: { sentCount: 1 }
    },
    { upsert: true }
  );
  await messageService.sendOtp(phone, code);
  return { sentTo: maskPhone(phone) };
}

async function verify(userId, rawPhone, code, now = new Date()) {
  const phone = messageService.toIndianMobile(rawPhone);
  const entry = phone ? await PhoneCode.findOne({ user: userId, phone, purpose: "cod" }) : null;
  if (!entry || entry.expiresAt <= now) throw new HttpError(400, "That code has expired. Ask for a new one.", { codCode: "Ask for a new code." }, "cod_code_expired");
  if (entry.attempts >= MAX_TRIES) throw new HttpError(429, "Too many wrong codes. Ask for a new one.", { codCode: "Ask for a new code." }, "cod_code_expired");
  const given = Buffer.from(hash(userId, phone, String(code || "").trim()));
  const ok = given.length === Buffer.from(entry.codeHash).length && crypto.timingSafeEqual(given, Buffer.from(entry.codeHash));
  if (!ok) {
    await PhoneCode.updateOne({ _id: entry._id }, { $inc: { attempts: 1 } });
    throw new HttpError(400, "That code is not right. Check the message and try again.", { codCode: "That code is not right." }, "cod_code_wrong");
  }
  await PhoneCode.deleteOne({ _id: entry._id });
  await User.updateOne({ _id: userId }, { $pull: { verifiedPhones: { phone } } });
  await User.updateOne({ _id: userId }, { $push: { verifiedPhones: { $each: [{ phone, at: now }], $slice: -10 } } });
  return true;
}

module.exports = { isNeeded, send, verify, maskPhone, TRUST_MS };
