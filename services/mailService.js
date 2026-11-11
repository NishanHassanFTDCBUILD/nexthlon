// Sends email through a provider chosen by MAIL_DRIVER (providers/mail): smtp (default) or brevo.
// Without any provider set up:
//   - in development and tests the email is written to the console (and kept for tests), so
//     nothing crashes and you can see what would have gone out;
//   - in production sending fails with a clear message, because a silently lost email is worse.
// Callers that must not wait or fail (order emails, resets) run this from a job or the background; a failure
// there is retried. An error with permanent = true (the address does not exist) is not retried.
// Passwords and message bodies never go into the logs (only the recipient, masked, and subject).
const config = require("../config/env");
const logger = require("../utils/logger");
const { HttpError } = require("../utils/http");
const { createSmtpProvider } = require("../providers/mail/smtp");
const { createBrevoProvider } = require("../providers/mail/brevo");

let provider = null;
let testOutbox = null; // tests: an array that receives every email instead of the provider

function getProvider() {
  if (!provider && config.mail.enabled) {
    provider = config.mail.driver === "brevo" ? createBrevoProvider({ apiKey: config.mail.brevoApiKey }) : createSmtpProvider(config.mail);
  }
  return provider;
}

const maskEmail = email => String(email).replace(/^(.).*?(@.*)$/, "$1***$2");

// Tests: route every email into an array (or null to stop), or swap the provider for a fake one.
function useTestOutbox(outbox) {
  testOutbox = outbox;
}
function useProviderForTests(fake) {
  provider = fake;
}

function isConfigured() {
  return config.mail.enabled;
}

// message: { to, subject, text, html, headers? }
async function send(message) {
  const mail = { from: config.mail.from, to: message.to, subject: message.subject, text: message.text, html: message.html, headers: message.headers };
  if (testOutbox) {
    testOutbox.push(mail);
    return { delivered: false, logged: true };
  }
  // Tests that are not looking at email: drop it quietly (no console noise from every sign-up).
  if (process.env.NODE_ENV === "test" && !provider) return { delivered: false, logged: false };
  const active = getProvider();
  if (!active) {
    if (config.isProduction) throw new HttpError(503, "Email is not set up on this server (set SMTP_HOST, or MAIL_DRIVER=brevo with BREVO_API_KEY).");
    // Development: show the email instead of sending it.
    console.info(`\n[email not sent: no email provider is set up]\nTo: ${mail.to}\nSubject: ${mail.subject}\n\n${mail.text}\n`);
    return { delivered: false, logged: true };
  }
  try {
    const result = await active.send(mail);
    logger.info("mail.sent", { to: maskEmail(mail.to), subject: mail.subject, provider: active.driver });
    return { delivered: true, logged: false, id: result.id || "", provider: active.driver };
  } catch (error) {
    logger.error("mail.failed", { to: maskEmail(mail.to), subject: mail.subject, provider: active.driver, error });
    const failure = new HttpError(502, "The email could not be sent. Please try again later.");
    failure.permanent = Boolean(error.permanent);
    throw failure;
  }
}

module.exports = { send, isConfigured, useTestOutbox, useProviderForTests, maskEmail };
