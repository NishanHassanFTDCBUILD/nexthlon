// Referrals. Every customer has a code. A NEW customer who signs up with someone's code gets
// wallet credit, and so does the friend who invited them. The amount is a store setting the
// admin can change. It happens once per new customer: both credits carry a unique key.
const crypto = require("crypto");
const User = require("../models/User");
const walletService = require("./walletService");
const settingsService = require("./settingsService");
const { HttpError } = require("../utils/http");
const logger = require("../utils/logger");

const CODE = /^[A-Z0-9]{6,12}$/;
// The random part has no 0/O or 1/I, so a code typed from a screenshot is never ambiguous.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

// Up to 4 letters of the name, then random characters, 8 in all: ASHA7K2P.
function makeCode(name = "", random = crypto.randomBytes(8)) {
  let code = String(name).toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4) || "NX";
  for (let i = 0; code.length < 8; i += 1) code += ALPHABET[random[i] % ALPHABET.length];
  return code;
}

function normaliseCode(raw) {
  return typeof raw === "string" ? raw.replace(/\s+/g, "").toUpperCase() : "";
}

// Gives the user a code if they do not have one yet. Retries if a code is already taken.
async function ensureCode(user) {
  if (user.referralCode) return user.referralCode;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = makeCode(user.name);
    try {
      const updated = await User.findOneAndUpdate(
        { _id: user._id, referralCode: { $exists: false } },
        { $set: { referralCode: code } },
        { new: true }
      );
      if (updated) {
        user.referralCode = updated.referralCode;
        return updated.referralCode;
      }
      const fresh = await User.findById(user._id).select("referralCode").lean();
      if (fresh && fresh.referralCode) {
        user.referralCode = fresh.referralCode;
        return fresh.referralCode;
      }
    } catch (error) {
      if (error.code !== 11000) throw error;
    }
  }
  throw new Error("Could not create a referral code.");
}

// Finds the customer who owns this code, for sign-up. Throws a field error for a bad code.
async function findReferrer(rawCode) {
  const code = normaliseCode(rawCode);
  if (!code) return null;
  const referrer = CODE.test(code) ? await User.findOne({ referralCode: code, role: "customer" }).select("_id name isBlocked").lean() : null;
  if (!referrer || referrer.isBlocked) {
    throw new HttpError(400, "This referral code is not valid.", { referralCode: "This referral code is not valid. Check it, or leave it empty." });
  }
  return referrer;
}

// Credits both people for a new sign-up. Safe to call twice: the keys stop a second credit.
async function rewardSignup(newUser, referrer) {
  if (!referrer) return { reward: 0 };
  const reward = await settingsService.get("referralReward");
  if (!(reward > 0)) return { reward: 0 };
  const firstName = String(newUser.name).split(" ")[0];
  await walletService.credit(newUser._id, reward, { kind: "referral", reason: "Welcome bonus for joining with a referral code", key: `referral:joined:${newUser._id}` });
  await walletService.credit(referrer._id, reward, { kind: "referral", reason: `Referral bonus: ${firstName} joined with your code`, key: `referral:invited:${newUser._id}` });
  logger.info("referral.rewarded", { user: String(newUser._id), referrer: String(referrer._id), reward });
  return { reward };
}

// What the wallet page shows: the code, a share link, the reward and how many friends joined.
async function getReferral(user, baseUrl = "") {
  const code = await ensureCode(user);
  const [reward, joined] = await Promise.all([
    settingsService.get("referralReward"),
    User.countDocuments({ referredBy: user._id })
  ]);
  return { code, link: `${baseUrl}/signup?ref=${code}`, reward, joined };
}

// Older accounts made before referrals existed get a code.
async function migrateCodes() {
  const users = await User.find({ role: "customer", referralCode: { $exists: false } }).select("_id name").limit(5000);
  for (const user of users) await ensureCode(user);
  return users.length;
}

module.exports = { CODE, makeCode, normaliseCode, ensureCode, findReferrer, rewardSignup, getReferral, migrateCodes };
