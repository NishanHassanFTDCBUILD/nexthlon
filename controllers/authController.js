const authService = require("../services/authService");
const { signToken, setAuthCookie, clearAuthCookie, kindOf } = require("../services/tokenService");
const { validateSignup, validateLogin, hasErrors } = require("../utils/validators");
const { HttpError, asyncHandler } = require("../utils/http");
const { formatPaise } = require("../utils/money");
const accountService = require("../services/accountService");
const logger = require("../utils/logger");

// Adds the sign-in to the account's login activity (browser and masked IP). Never blocks signing in.
async function noteLogin(req, user) {
  try {
    await accountService.recordLogin(user._id, { userAgent: req.get("user-agent"), ip: req.ip });
  } catch (error) {
    logger.warn("login_activity.failed", { error });
  }
}

// Issues the JWT, stores it in the httpOnly cookie (nx_token for customers, nx_admin for admins),
// and also returns it for API tools like Postman.
function sendSignedIn(res, user, status, message) {
  const token = signToken(user);
  setAuthCookie(res, token, kindOf(user));
  res.status(status).json({ message, user: user.toSafeJSON(), token });
}

// POST /api/signup
const signup = asyncHandler(async (req, res) => {
  const { errors, value } = validateSignup(req.body);
  if (hasErrors(errors)) throw new HttpError(400, "Please fix the highlighted fields.", errors);
  const user = await authService.registerCustomer(value);
  await noteLogin(req, user);
  const bonus = user.referralReward ? ` ${formatPaise(user.referralReward)} has been added to your wallet.` : "";
  sendSignedIn(res, user, 201, `Welcome to Nexthlon! Your account is ready.${bonus}`);
});

// POST /api/login
const login = asyncHandler(async (req, res) => {
  const { errors, value } = validateLogin(req.body);
  if (hasErrors(errors)) throw new HttpError(400, "Please fix the highlighted fields.", errors);
  const user = await authService.authenticate(value, "customer");
  await noteLogin(req, user);
  sendSignedIn(res, user, 200, `Welcome back, ${user.name.split(" ")[0]}!`);
});

// POST /api/admin/login
const adminLogin = asyncHandler(async (req, res) => {
  const { errors, value } = validateLogin(req.body);
  if (hasErrors(errors)) throw new HttpError(400, "Please fix the highlighted fields.", errors);
  const user = await authService.authenticate(value, "admin");
  await noteLogin(req, user);
  sendSignedIn(res, user, 200, "Signed in to the admin console.");
});

// GET /api/me
function me(req, res) {
  res.json({ user: req.user.toSafeJSON() });
}

// POST /api/logout
// JWTs are stateless, so signing out means deleting the cookie that holds the token.
function logout(req, res) {
  clearAuthCookie(res, "customer");
  res.json({ message: "You have been signed out." });
}

// POST /api/admin/logout (only the admin session ends; a customer session in the same browser stays)
function adminLogout(req, res) {
  clearAuthCookie(res, "admin");
  res.json({ message: "You have been signed out of the admin console." });
}

module.exports = { signup, login, adminLogin, me, logout, adminLogout };
