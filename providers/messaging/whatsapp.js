// WhatsApp Business through Meta's Cloud API (E1). Business-started messages must use templates approved
// in WhatsApp Manager; each template here has numbered parameters ({{1}}, {{2}} ...) filled in order.
// Create these templates (category "Utility", language WHATSAPP_TEMPLATE_LANGUAGE) before going live:
//   nx_order_placed      {{1}} name, {{2}} order id, {{3}} amount
//   nx_order_shipped     {{1}} name, {{2}} order id, {{3}} courier, {{4}} tracking number
//   nx_out_for_delivery  {{1}} name, {{2}} order id
//   nx_order_delivered   {{1}} name, {{2}} order id
//   nx_cod_otp           {{1}} code   (category "Authentication", with a copy-code button)
const TIMEOUT_MS = 8000;

function createWhatsAppProvider(
  {token, phoneNumberId, language, apiVersion},
  transport = fetch,
) {
  return {
    name: 'whatsapp',
    async send({to, template, params = [], button = null}) {
      const components = [
        {
          type: 'body',
          parameters: params.map((value) => ({
            type: 'text',
            text: String(value).slice(0, 1000),
          })),
        },
      ];
      // Authentication templates repeat the code on their copy-code button.
      if (button)
        components.push({
          type: 'button',
          sub_type: 'url',
          index: '0',
          parameters: [{type: 'text', text: String(button)}],
        });
      const response = await transport(
        `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to,
            type: 'template',
            template: {name: template, language: {code: language}, components},
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(
          `WhatsApp refused the message: ${(data.error && data.error.message) || response.status}`,
        );
        // Wrong number or not on WhatsApp: trying again cannot help.
        error.permanent = response.status === 400;
        throw error;
      }
      return {
        provider: 'whatsapp',
        id: (data.messages && data.messages[0] && data.messages[0].id) || '',
      };
    },
  };
}

module.exports = {createWhatsAppProvider};
