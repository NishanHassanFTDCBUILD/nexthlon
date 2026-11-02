const bcrypt = require("bcryptjs");
const User = require("../models/User");
const { HttpError } = require("../utils/http");

const BCRYPT_ROUNDS = 12;
// Compared against when the email does not exist, so a wrong email takes as long as a wrong password.
const DUMMY_HASH = bcrypt.hashSync("nexthlon-timing-guard", BCRYPT_ROUNDS);

async function registerCustomer({ name, email, password }) {
  if (await User.exists({ email })) {
    throw new HttpError(409, "An account with this email already exists.", {
      email: "This email is already registered. Try signing in."
    });
  }
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  try {
    return await User.create({ name, email, passwordHash, role: "customer" });
  } catch (error) {
    if (error.code === 11000) throw new HttpError(409, "An account with this email already exists.");
    throw error;
  }
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
