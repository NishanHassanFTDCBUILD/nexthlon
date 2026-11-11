// The look of every email Nexthlon sends: a dark brand bar, one clear message, one big button, and the
// link printed underneath for mail apps that hide buttons. Table layout and inline styles, because email
// apps ignore stylesheets. Returns { html, text }, so each email also has a plain-text version.
//
//   renderEmail({ preheader, heading, paragraphs: ["...", "..."], button: { label, url }, note })
//
// Everything is escaped here, so callers pass plain text.
const config = require("../config/env");
const { STORE } = require("../config/store");

const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

const VOLT = "#d4ff3a";
const INK = "#0a0a0b";

function renderEmail({ preheader = "", heading, paragraphs = [], button = null, note = "" }) {
  const brand = escapeHtml(STORE.brandName);
  const paragraphHtml = paragraphs.map(text => `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#2e2e33;">${escapeHtml(text)}</p>`).join("");
  const buttonHtml = button ? `
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:8px 0 20px;"><tr>
            <td style="border-radius:12px;background:${VOLT};">
              <a href="${escapeHtml(button.url)}" style="display:inline-block;padding:14px 28px;font-size:16px;font-weight:700;color:${INK};text-decoration:none;border-radius:12px;">${escapeHtml(button.label)}</a>
            </td>
          </tr></table>
          <p style="margin:0 0 16px;font-size:13px;line-height:1.5;color:#5c5c64;">Button not working? Copy this address into your browser:<br><a href="${escapeHtml(button.url)}" style="color:#4a6200;word-break:break-all;">${escapeHtml(button.url)}</a></p>` : "";
  const noteHtml = note ? `<p style="margin:0;font-size:13px;line-height:1.5;color:#5c5c64;">${escapeHtml(note)}</p>` : "";

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(heading)}</title></head>
<body style="margin:0;padding:0;background:#f4f4ef;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preheader)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f4f4ef;"><tr><td align="center" style="padding:24px 12px;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;font-family:Inter,'Segoe UI',Roboto,Arial,sans-serif;">
      <tr><td style="background:${INK};padding:22px 28px;border-radius:16px 16px 0 0;">
        <span style="font-size:22px;font-weight:800;letter-spacing:2px;color:#ffffff;">${brand.toUpperCase()}</span>
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${VOLT};margin-left:6px;"></span>
      </td></tr>
      <tr><td style="background:#ffffff;padding:32px 28px 28px;border-radius:0 0 16px 16px;">
        <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;color:${INK};">${escapeHtml(heading)}</h1>
        ${paragraphHtml}${buttonHtml}${noteHtml}
      </td></tr>
      <tr><td style="padding:18px 12px;text-align:center;font-size:12px;line-height:1.6;color:#74747c;">
        ${escapeHtml(STORE.legalName)} · ${escapeHtml(STORE.address)}<br>
        Questions? Write to ${escapeHtml(STORE.supportEmail)}
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;

  const text = [
    heading,
    "",
    ...paragraphs.flatMap(paragraph => [paragraph, ""]),
    ...(button ? [`${button.label}:`, button.url, ""] : []),
    ...(note ? [note, ""] : []),
    `${STORE.brandName} · ${STORE.supportEmail}`
  ].join("\n");

  return { html, text };
}

// The store's public address for links in emails. In production it is SITE_URL (always set: the
// start-up check insists). Elsewhere, the address the request came to, so links work on a phone on
// the same network. Never the Host header in production: a forged one could point a reset link at
// someone else's website.
function siteUrlFor(req) {
  if (config.siteUrl) return config.siteUrl;
  if (config.isProduction) throw new Error("SITE_URL is not set");
  return `${req.protocol}://${req.get("host")}`;
}

module.exports = { renderEmail, escapeHtml, siteUrlFor };
