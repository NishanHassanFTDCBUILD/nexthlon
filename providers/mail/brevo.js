// Email through Brevo's HTTPS API (https://www.brevo.com, formerly Sendinblue): no SMTP port to open, works from
// any host, and a free plan of 300 emails a day. Settings: MAIL_DRIVER=brevo, BREVO_API_KEY (an "API key" from
// SMTP & API in the Brevo account) and MAIL_FROM (an address on a domain verified in Brevo).
const URL_DEFAULT = 'https://api.brevo.com/v3/smtp/email';
const TIMEOUT_MS = 15_000;

// "Nexthlon <orders@nexthlon.in>" -> { name, email }.
function parseAddress(text) {
  const match = /^\s*(?:"?([^"<]*?)"?\s*)?<([^>]+)>\s*$/.exec(String(text));
  return match
    ? {...(match[1] ? {name: match[1].trim()} : {}), email: match[2].trim()}
    : {email: String(text).trim()};
}

function createBrevoProvider(
  {apiKey},
  {url = URL_DEFAULT, fetchImpl = fetch} = {},
) {
  return {
    driver: 'brevo',
    async send({from, to, subject, text, html, headers}) {
      let response;
      try {
        response = await fetchImpl(url, {
          method: 'POST',
          headers: {
            'api-key': apiKey,
            'content-type': 'application/json',
            accept: 'application/json',
          },
          body: JSON.stringify({
            sender: parseAddress(from),
            to: [parseAddress(to)],
            subject,
            htmlContent: html,
            textContent: text,
            ...(headers && Object.keys(headers).length ? {headers} : {}),
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (error) {
        // No answer (network, timeout): worth another try. The message never carries the API key.
        throw new Error(
          `Brevo could not be reached: ${error.name === 'TimeoutError' ? 'timed out' : error.message}`,
          {cause: error},
        );
      }
      if (!response.ok) {
        // 4xx (bad address, bad key, sender not verified) will not fix itself, except "too many" and "timeout".
        const error = new Error(`Brevo answered ${response.status}`);
        error.status = response.status;
        error.permanent =
          response.status >= 400 &&
          response.status < 500 &&
          ![408, 429].includes(response.status);
        throw error;
      }
      const body = await response.json().catch(() => ({}));
      return {id: body.messageId ? String(body.messageId) : ''};
    },
  };
}

module.exports = {createBrevoProvider, parseAddress};
