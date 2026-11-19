// SMS one-time codes through MSG91 (E2), India's DLT rules included: the template is registered on
// MSG91 with a DLT template id and one variable for the code (MSG91_OTP_TEMPLATE_ID).
const TIMEOUT_MS = 8000;

function createSmsProvider({authKey, otpTemplateId}, transport = fetch) {
  return {
    name: 'sms',
    async sendOtp({to, code}) {
      const response = await transport(
        'https://control.msg91.com/api/v5/flow',
        {
          method: 'POST',
          headers: {
            authkey: authKey,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            template_id: otpTemplateId,
            short_url: '0',
            recipients: [{mobiles: to, otp: code}],
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.type === 'error')
        throw new Error(
          `MSG91 refused the SMS: ${data.message || response.status}`,
        );
      return {provider: 'sms', id: data.message || ''};
    },
  };
}

module.exports = {createSmsProvider};
