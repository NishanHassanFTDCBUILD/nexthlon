const authService = require("../services/authService");
const { signToken, setAuthCookie, clearAuthCookie } = require("../services/tokenService");
const { validateSignup, validateLogin, hasErrors } = require("../utils/validators");
const { HttpError, asyncHandler } = require("../utils/http");
const { formatPaise } = require("../utils/money");

// Issues the JWT, stores it in the httpOnly cookie, and also returns it for API tools like Postman.
function sendSignedIn(res, user, status, message) {
  const token = signToken(user);
  setAuthCookie(res, token);
  res.status(status).json({ message, user: user.toSafeJSON(), token });
}

// POST /api/signup
const signup = asyncHandler(async (req, res) => {
  const { errors, value } = validateSignup(req.body);
  if (hasErrors(errors)) throw new HttpError(400, "Please fix the highlighted fields.", errors);
  const user = await authService.registerCustomer(value);
  const bonus = user.referralReward ? ` ${formatPaise(user.referralReward)} has been added to your wallet.` : "";
  sendSignedIn(res, user, 201, `Welcome to Nexthlon! Your account is ready.${bonus}`);
});

// POST /api/login
const login = asyncHandler(async (req, res) => {
  const { errors, value } = validateLogin(req.body);
  if (hasErrors(errors)) throw new HttpError(400, "Please fix the highlighted fields.", errors);
  const user = await authService.authenticate(value, "customer");
  sendSignedIn(res, user, 200, `Welcome back, ${user.name.split(" ")[0]}!`);
});

// POST /api/admin/login
const adminLogin = asyncHandler(async (req, res) => {
  const { errors, value } = validateLogin(req.body);
  if (hasErrors(errors)) throw new HttpError(400, "Please fix the highlighted fields.", errors);
  const user = await authService.authenticate(value, "admin");
  sendSignedIn(res, user, 200, "Signed in to the admin console.");
});

// GET /api/me
function me(req, res) {
  res.json({ user: req.user.toSafeJSON() });
}

// POST /api/logout and POST /api/admin/logout
// JWTs are stateless, so signing out means deleting the cookie that holds the token.
function logout(req, res) {
  clearAuthCookie(res);
  res.json({ message: "You have been signed out." });
}

module.exports = { signup, login, adminLogin, me, logout };
