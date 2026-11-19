// Courier tracking webhook (B5). Shiprocket posts every status change here with our token in the
// x-api-key header. Mounted in app.js before the origin check (couriers send no Origin header); the
// token is the proof the update is real. Unknown parcels still get 200, so Shiprocket stops retrying.
const shippingService = require('../services/shippingService');
const webhookLogService = require('../services/webhookLogService');
const logger = require('../utils/logger');

async function courierWebhook(req, res) {
  const authorised = shippingService.webhookAuthorised(req.get('x-api-key'));
  if (!authorised) {
    await webhookLogService.record({
      provider: 'shiprocket',
      event: 'refused',
      outcome: 'rejected',
      signatureOk: false,
      error: new Error('Wrong or missing token'),
    });
    return res.status(401).json({message: 'Unauthorised.'});
  }
  const body = req.body || {};
  const event = String(body.event || body.current_status || 'tracking');
  const externalId = String(body.awb || body.order_id || '');
  try {
    const result = await shippingService.handleTrackingUpdate(body);
    if (result.ignored)
      logger.info('shipping.webhook_ignored', {reason: result.ignored});
    await webhookLogService.record({
      provider: 'shiprocket',
      event,
      externalId,
      signatureOk: true,
      outcome: result.ignored ? 'ignored' : 'processed',
      error: result.ignored ? new Error(String(result.ignored)) : null,
    });
    return res.json({ok: true});
  } catch (error) {
    // A 500 makes Shiprocket send it again later, which is what we want for a passing database error.
    logger.error('shipping.webhook_failed', {error});
    await webhookLogService.record({
      provider: 'shiprocket',
      event,
      externalId,
      signatureOk: true,
      outcome: 'failed',
      error,
    });
    return res.status(500).json({ok: false});
  }
}

module.exports = {courierWebhook};
