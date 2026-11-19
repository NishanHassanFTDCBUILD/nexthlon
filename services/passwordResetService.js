// "I forgot my password": a one-time link by email, then a new password.
//
// What it protects against:
//   - Guessing which emails have accounts. The request answers the same way (and as fast) for any
//     address: the lookup and the email happen in the background (utils/background.js).
//   - A flood of emails to one inbox: at most MAX_PER_HOUR reset emails per account per hour.
//   - A link that is read twice, is old, or was replaced by a newer one: it works once, for 30 minutes,
//     and only the newest link works (services/authTokenService.js).
//   - A thief who got in and changes nothing but wants to stay: a reset signs out every device
//     (refresh tokens are revoked, tokenVersion is raised).
// Only customer accounts can use it. An admin's password is changed from the command line, so the
// public site never has a way to take over the console.
const User = require('../models/User');
const authTokenService = require('./authTokenService');
const authMailService = require('./authMailService');
const authService = require('./authService');
const refreshTokenService = require('./refreshTokenService');
const auditService = require('./auditService');
const {HttpError} = require('../utils/http');
const {background} = require('../utils/background');
const {runExclusive} = require('../utils/exclusive');

const MAX_PER_HOUR = 3;
const BAD_LINK =
  'This reset link has expired or was already used. Please ask for a new one.';

// Sends the email, if there is an account to send it to. Never tells the caller whether there was.
function requestReset(email, {baseUrl, ip = ''}) {
  return background('password_reset.request', async () => {
    const user = await User.findOne({
      email,
      role: 'customer',
      isDeleted: false,
    });
    // A blocked customer cannot sign in anyway; nobody is told either way.
    if (!user || user.isBlocked) return;
    // One at a time per account, so a burst of requests cannot all pass the "3 an hour" check together.
    await runExclusive(`reset:${user._id}`, async () => {
      if (
        (await authTokenService.countRecent(user._id, 'password_reset')) >=
        MAX_PER_HOUR
      )
        return;
      const raw = await authTokenService.issue(user, 'password_reset', {
        ip: auditService.maskIp(ip),
      });
      await authMailService.sendPasswordReset(
        user,
        `${baseUrl}/reset-password?token=${raw}`,
      );
    });
  });
}

// Does the link on the reset page still work? (Looked at when the page opens, without using it.)
const isLinkUsable = (raw) => authTokenService.isUsable(raw, 'password_reset');

// Sets the new password. Returns the user (for the audit log and the notice email).
async function resetPassword(raw, newPassword, {baseUrl, ip = ''}) {
  const record = await authTokenService.consume(raw, 'password_reset');
  if (!record) throw new HttpError(400, BAD_LINK);
  const user = await User.findById(record.user).select('+passwordHash');
  if (!user || user.isDeleted || user.role !== 'customer')
    throw new HttpError(400, BAD_LINK);

  user.passwordHash = await authService.hashPassword(newPassword);
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  // The link went to this inbox and was opened, which is exactly what confirming an email proves.
  if (!user.emailVerifiedAt) user.emailVerifiedAt = new Date();
  await user.save();

  // Every device is signed out, and any other reset link that is still out there stops working.
  await refreshTokenService.revokeAllForUser(user._id, 'password_reset');
  await authTokenService.invalidateAll(user._id, 'password_reset');
  await auditService.record({
    actor: user._id,
    actorRole: 'customer',
    action: 'auth.password_reset',
    target: `user:${user._id}`,
    ip,
  });

  // Tell the owner, so a reset they did not ask for does not go unnoticed.
  background('password_reset.notice', () =>
    authMailService.sendPasswordChanged(user, {
      loginUrl: `${baseUrl}/forgot-password`,
    }),
  );
  return user;
}

module.exports = {
  requestReset,
  resetPassword,
  isLinkUsable,
  MAX_PER_HOUR,
  BAD_LINK,
};
