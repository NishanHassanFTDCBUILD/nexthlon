// Email over SMTP with nodemailer: any provider that gives you a host, user and password (Amazon SES SMTP,
// Brevo SMTP, Zoho, Gmail for a small test...). Settings: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS.
const nodemailer = require('nodemailer');

function createSmtpProvider(
  {host, port, secure, user, pass},
  {transport} = {},
) {
  let smtp = transport || null;
  const get = () => {
    if (!smtp) {
      smtp = nodemailer.createTransport({
        host,
        port,
        secure,
        auth: user ? {user, pass} : undefined,
        connectionTimeout: 15_000,
        socketTimeout: 30_000,
      });
    }
    return smtp;
  };
  return {
    driver: 'smtp',
    async send({from, to, subject, text, html, headers}) {
      try {
        const info = await get().sendMail({
          from,
          to,
          subject,
          text,
          html,
          headers,
        });
        return {id: info && info.messageId ? String(info.messageId) : ''};
      } catch (error) {
        // 5xx replies to a message ("no such mailbox", "message rejected") will not change by trying again;
        // connection problems and 4xx ("try later") will.
        error.permanent =
          Number.isInteger(error.responseCode) && error.responseCode >= 500;
        throw error;
      }
    },
  };
}

module.exports = {createSmtpProvider};
