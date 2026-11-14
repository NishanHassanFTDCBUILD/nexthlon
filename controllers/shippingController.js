// Courier tracking webhook (B5). Shiprocket posts every status change here with our token in the
// x-api-key header. Mounted in app.js before the origin check (couriers send no Origin header); the
// token is the proof the update is real. Unknown parcels still get 200, so Shiprocket stops retrying.
const shippingService = require("../services/shippingService");
const logger = require("../utils/logger");

async function courierWebhook(req, res) {
  if (!shippingService.webhookAuthorised(req.get("x-api-key"))) {
    return res.status(401).json({ message: "Unauthorised." });
  }
  try {
    const result = await shippingService.handleTrackingUpdate(req.body || {});
    if (result.ignored) logger.info("shipping.webhook_ignored", { reason: result.ignored });
    return res.json({ ok: true });
  } catch (error) {
    // A 500 makes Shiprocket send it again later, which is what we want for a passing database error.
    logger.error("shipping.webhook_failed", { error });
    return res.status(500).json({ ok: false });
  }
}

module.exports = { courierWebhook };
