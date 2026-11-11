// "Confirm your email": a link sent to the address on the account. Opening it proves the address is
// real and belongs to this person, so order emails and password resets reach the right inbox.
// Nothing is blocked until it is confirmed; the shop only reminds (a banner with a "send again" button).
const User = require("../models/User");
const authTokenService = require("./authTokenService");
const authMailService = require("./authMailService");
const auditService = require("./auditService");
const { HttpError } = require("../utils/http");
const { background } = require("../utils/background");
const { runExclusive } = require("../utils/exclusive");

// At most this many confirmation emails per account per hour.
const MAX_PER_HOUR = 4;
const BAD_LINK = "This confirmation link has expired or was already used. Sign in and ask for a new one from your account.";

// Issues a link and emails it. Used at sign-up and after the email changes (in the background: the
// customer is already on their way and must not wait for, or fail because of, an email server).
function sendInBackground(user, { baseUrl, ip = "" }) {
  return background("email_verification.send", () => sendNow(user, { baseUrl, ip }));
}

async function sendNow(user, { baseUrl, ip = "" }) {
  const raw = await authTokenService.issue(user, "email_verify", { ip: auditService.maskIp(ip) });
  await authMailService.sendEmailVerification(user, `${baseUrl}/verify-email?token=${raw}`);
}

// "Send it again" from the account: the customer is waiting and sees the result, so this one answers.
async function resend(user, { baseUrl, ip = "" }) {
  if (user.emailVerifiedAt) throw new HttpError(400, "Your email is already confirmed.");
  await runExclusive(`verify:${user._id}`, async () => {
    if (await authTokenService.countRecent(user._id, "email_verify") >= MAX_PER_HOUR) {
      throw new HttpError(429, "We have sent several confirmation emails already. Please check your inbox and spam folder, or try again in an hour.");
    }
    await sendNow(user, { baseUrl, ip });
  });
}

// Opening the link: marks the address confirmed. Returns the user.
async function verify(raw) {
  const record = await authTokenService.consume(raw, "email_verify");
  if (!record) throw new HttpError(400, BAD_LINK);
  const user = await User.findById(record.user);
  if (!user || user.isDeleted) throw new HttpError(400, BAD_LINK);
  // The link was for an address the customer has since changed: it must not confirm the new one.
  if (record.sentTo && record.sentTo !== user.email) {
    throw new HttpError(400, "This link was for an earlier email address. Sign in and ask for a new one from your account.");
  }
  if (!user.emailVerifiedAt) {
    user.emailVerifiedAt = new Date();
    await user.save();
    await auditService.record({ actor: user._id, actorRole: user.role, action: "account.email_verified", target: `user:${user._id}` });
  }
  return user;
}

const isLinkUsable = raw => authTokenService.isUsable(raw, "email_verify");

module.exports = { sendInBackground, sendNow, resend, verify, isLinkUsable, MAX_PER_HOUR, BAD_LINK };
