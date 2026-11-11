// The emails about signing in: reset your password, confirm your email, "your password was changed",
// and two-step login turned on or off. Each is a short, plain message with one action (utils/emailLayout.js).
const mailService = require("./mailService");
const { renderEmail } = require("../utils/emailLayout");
const { STORE } = require("../config/store");

const firstName = user => String(user.name || "").trim().split(/\s+/)[0] || "there";

function send(user, subject, content) {
  const { html, text } = renderEmail(content);
  return mailService.send({ to: user.email, subject, html, text });
}

function sendPasswordReset(user, url, { minutes = 30 } = {}) {
  return send(user, `Reset your ${STORE.brandName} password`, {
    preheader: `This link works for ${minutes} minutes.`,
    heading: "Reset your password",
    paragraphs: [
      `Hi ${firstName(user)}, we got a request to reset the password for your ${STORE.brandName} account.`,
      `Choose a new password with the button below. The link works once, for ${minutes} minutes.`
    ],
    button: { label: "Choose a new password", url },
    note: "If you did not ask for this, you can ignore this email: your password stays as it is."
  });
}

function sendEmailVerification(user, url) {
  return send(user, `Confirm your email for ${STORE.brandName}`, {
    preheader: "One tap to confirm this is your email address.",
    heading: "Confirm your email",
    paragraphs: [
      `Welcome to ${STORE.brandName}, ${firstName(user)}! Please confirm that this is your email address, so we can send you order updates and help you get back in if you forget your password.`
    ],
    button: { label: "Confirm my email", url },
    note: "The link works for 48 hours. If you did not create this account, you can ignore this email."
  });
}

function sendPasswordChanged(user, { when = new Date(), loginUrl } = {}) {
  const time = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(when);
  return send(user, `Your ${STORE.brandName} password was changed`, {
    preheader: `Changed on ${time} IST.`,
    heading: "Your password was changed",
    paragraphs: [
      `Hi ${firstName(user)}, the password for your ${STORE.brandName} account was changed on ${time} IST, and you were signed out on every device.`,
      `If this was you, there is nothing to do. If it was not, reset your password now and write to ${STORE.supportEmail}.`
    ],
    ...(loginUrl ? { button: { label: "Reset my password", url: loginUrl } } : {})
  });
}

function sendTwoFactorChanged(user, enabled) {
  return send(user, `Two-step login ${enabled ? "turned on" : "turned off"} for your ${STORE.brandName} admin account`, {
    preheader: enabled ? "Your account is better protected." : "Your account is less protected.",
    heading: `Two-step login ${enabled ? "turned on" : "turned off"}`,
    paragraphs: [
      enabled
        ? `Hi ${firstName(user)}, two-step login is now on for your ${STORE.brandName} admin account. From now on, signing in needs a code from your authenticator app.`
        : `Hi ${firstName(user)}, two-step login was turned off for your ${STORE.brandName} admin account. Signing in needs only the password now.`,
      "If you did not do this, change your password and tell the other admins straight away."
    ]
  });
}

module.exports = { sendPasswordReset, sendEmailVerification, sendPasswordChanged, sendTwoFactorChanged };
