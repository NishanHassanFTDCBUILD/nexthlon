const bcrypt = require("bcryptjs");
const User = require("../models/User");
const referralService = require("./referralService");
const { HttpError } = require("../utils/http");
const logger = require("../utils/logger");

const BCRYPT_ROUNDS = 12;
// Compared against when the email does not exist, so a wrong email takes as long as a wrong password.
const DUMMY_HASH = bcrypt.hashSync("nexthlon-timing-guard", BCRYPT_ROUNDS);

// Creates a customer with their own referral code. With a friend's code, both get the
// referral reward in their wallets (once only).
async function registerCustomer({ name, email, password, referralCode = "" }) {
  if (await User.exists({ email })) {
    throw new HttpError(409, "An account with this email already exists.", {
      email: "This email is already registered. Try signing in."
    });
  }
  const referrer = await referralService.findReferrer(referralCode);
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  let user;
  for (let attempt = 0; !user; attempt += 1) {
    try {
      user = await User.create({ name, email, passwordHash, role: "customer", referralCode: referralService.makeCode(name), referredBy: referrer ? referrer._id : null });
    } catch (error) {
      const codeTaken = error.code === 11000 && error.keyPattern && error.keyPattern.referralCode;
      if (codeTaken && attempt < 4) continue;
      if (error.code === 11000) throw new HttpError(409, "An account with this email already exists.");
      throw error;
    }
  }
  if (referrer) {
    // The account is made either way; a failed reward is logged, and can be credited again safely.
    try {
      user.referralReward = (await referralService.rewardSignup(user, referrer)).reward;
    } catch (error) {
      logger.error("referral.reward_failed", { user: String(user._id), error });
    }
  }
  return user;
}

// Checks the password, then the role, then the blocked flag.
async function authenticate({ email, password }, expectedRole) {
  const user = await User.findOne({ email }).select("+passwordHash");
  const passwordMatches = await bcrypt.compare(password, user ? user.passwordHash : DUMMY_HASH);
  if (!user || !passwordMatches) {
    throw new HttpError(401, "Incorrect email or password.");
  }
  if (user.role !== expectedRole) {
    throw new HttpError(403, expectedRole === "admin"
      ? "This account does not have admin access."
      : "Administrators sign in from the admin login page.");
  }
  if (user.isBlocked) {
    throw new HttpError(403, "Your account has been blocked. Please contact Nexthlon support.");
  }
  user.lastLoginAt = new Date();
  await user.save();
  return user;
}

async function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

module.exports = { registerCustomer, authenticate, hashPassword, BCRYPT_ROUNDS };
