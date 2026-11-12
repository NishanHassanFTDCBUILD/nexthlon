// Forgot password, reset password, and confirming an email address: the API, and the three pages
// the emailed links open. The services hold the rules (services/passwordResetService.js,
// services/emailVerificationService.js); this file only reads the request and shapes the reply.
const passwordResetService = require("../services/passwordResetService");
const emailVerificationService = require("../services/emailVerificationService");
const { endSession } = require("../services/tokenService");
const { validateForgot, validatePasswordReset, validateToken, hasErrors } = require("../utils/validators");
const { siteUrlFor } = require("../utils/emailLayout");
const { HttpError, asyncHandler } = require("../utils/http");
const { toPublicUser } = require("../utils/publicUser");

function checked(validate, body) {
  const { errors, value } = validate(body);
  if (hasErrors(errors)) throw new HttpError(400, errors.form || "Please fix the highlighted fields.", errors);
  return value;
}

// ---------- API ----------

// POST /api/password/forgot   { email }
// The reply is the same whether or not the address has an account, and it does not wait for the
// email: what happens next runs in the background (see passwordResetService).
const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = checked(validateForgot, req.body);
  passwordResetService.requestReset(email, { baseUrl: siteUrlFor(req), ip: req.ip });
  res.json({ message: "If there is an account for that email, we have sent a link to reset the password. It works for 30 minutes." });
});

// POST /api/password/reset   { token, password, confirmPassword }
const resetPassword = asyncHandler(async (req, res) => {
  const { token, password } = checked(validatePasswordReset, req.body);
  await passwordResetService.resetPassword(token, password, { baseUrl: siteUrlFor(req), ip: req.ip });
  // Every device was signed out, this one included: clear its cookies too.
  endSession(res, "customer");
  res.json({ message: "Your password has been changed. Sign in with the new one.", redirect: "/login?reason=password_reset" });
});

// POST /api/email/verify   { token }
const verifyEmail = asyncHandler(async (req, res) => {
  const { token } = checked(validateToken, req.body);
  const user = await emailVerificationService.verify(token);
  res.json({ message: "Your email is confirmed. Thank you!", user: toPublicUser(user) });
});

// POST /api/account/email/resend   (signed-in customers)
const resendVerification = asyncHandler(async (req, res) => {
  await emailVerificationService.resend(req.user, { baseUrl: siteUrlFor(req), ip: req.ip });
  res.json({ message: `We sent a confirmation link to ${req.user.email}. It works for 48 hours.` });
});

// ---------- Pages ----------

// The links in the emails open these. A token in the address is a secret, so the page must not leak it
// to other sites (no-referrer), and nothing is used up by merely opening a page.
function recoveryPage(view, title) {
  return asyncHandler(async (req, res) => {
    const token = typeof req.query.token === "string" ? req.query.token : "";
    let state = view;
    if (view === "reset" && !(await passwordResetService.isLinkUsable(token))) state = "reset-invalid";
    if (view === "verify" && !(await emailVerificationService.isLinkUsable(token))) {
      // Opened a second time, or after confirming from another device: say so kindly.
      state = req.user && req.user.emailVerifiedAt ? "verify-done" : "verify-invalid";
    }
    res.set("Referrer-Policy", "no-referrer");
    res.render("pages/recovery", { title, view: state, token: ["reset", "verify"].includes(state) ? token : "" });
  });
}

const forgotPage = recoveryPage("forgot", "Forgot your password? | Nexthlon");
const resetPage = recoveryPage("reset", "Choose a new password | Nexthlon");
const verifyPage = recoveryPage("verify", "Confirm your email | Nexthlon");

module.exports = { forgotPassword, resetPassword, verifyEmail, resendVerification, forgotPage, resetPage, verifyPage };
