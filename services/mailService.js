// Sends email with nodemailer over SMTP (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM).
// Without SMTP settings:
//   - in development and tests the email is written to the console (and kept for tests), so
//     nothing crashes and you can see what would have gone out;
//   - in production sending fails with a clear message, because a silently lost email is worse.
// Passwords and message bodies never go into the logs (only the recipient, masked, and subject).
const nodemailer = require("nodemailer");
const config = require("../config/env");
const logger = require("../utils/logger");
const { HttpError } = require("../utils/http");

let transport = null;
let testOutbox = null; // tests: an array that receives every email instead of SMTP

function getTransport() {
  if (!transport && config.mail.enabled) {
    transport = nodemailer.createTransport({
      host: config.mail.host,
      port: config.mail.port,
      secure: config.mail.secure,
      auth: config.mail.user ? { user: config.mail.user, pass: config.mail.pass } : undefined
    });
  }
  return transport;
}

const maskEmail = email => String(email).replace(/^(.).*?(@.*)$/, "$1***$2");

// Tests: route every email into an array (or null to stop).
function useTestOutbox(outbox) {
  testOutbox = outbox;
}

function isConfigured() {
  return config.mail.enabled;
}

// message: { to, subject, text, html }
async function send(message) {
  const mail = { from: config.mail.from, to: message.to, subject: message.subject, text: message.text, html: message.html };
  if (testOutbox) {
    testOutbox.push(mail);
    return { delivered: false, logged: true };
  }
  const smtp = getTransport();
  if (!smtp) {
    if (config.isProduction) throw new HttpError(503, "Email is not set up on this server (SMTP settings are missing).");
    // Development: show the email instead of sending it.
    console.info(`\n[email not sent: SMTP is not set up]\nTo: ${mail.to}\nSubject: ${mail.subject}\n\n${mail.text}\n`);
    return { delivered: false, logged: true };
  }
  try {
    await smtp.sendMail(mail);
    logger.info("mail.sent", { to: maskEmail(mail.to), subject: mail.subject });
    return { delivered: true, logged: false };
  } catch (error) {
    logger.error("mail.failed", { to: maskEmail(mail.to), subject: mail.subject, error });
    throw new HttpError(502, "The email could not be sent. Please try again later.");
  }
}

module.exports = { send, isConfigured, useTestOutbox, maskEmail };
