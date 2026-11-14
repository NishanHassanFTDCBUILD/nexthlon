// Push notifications (E5). Mounted at /api/push.
//   GET    /key        the public VAPID key (or 404 when notifications are not set up)
//   POST   /subscribe  { endpoint, keys: { p256dh, auth } }   signed-in customers
//   DELETE /subscribe  { endpoint }
const router = require("express").Router();
const config = require("../config/env");
const pushService = require("../services/pushService");
const { requireAuth, requireRole } = require("../middleware/auth");
const { sensitiveLimiter } = require("../middleware/rateLimit");
const { asyncHandler, HttpError } = require("../utils/http");

router.get("/key", (req, res) => {
  if (!config.push.enabled) throw new HttpError(404, "Notifications are not set up.");
  res.set("Cache-Control", "public, max-age=3600");
  res.json({ publicKey: config.push.publicKey });
});
router.post("/subscribe", requireAuth, requireRole("customer"), sensitiveLimiter, asyncHandler(async (req, res) => {
  await pushService.subscribe(req.user._id, req.body, String(req.get("user-agent") || "").slice(0, 80));
  res.status(201).json({ message: "Notifications are on for this device." });
}));
router.delete("/subscribe", requireAuth, requireRole("customer"), asyncHandler(async (req, res) => {
  await pushService.unsubscribe(req.user._id, req.body && req.body.endpoint);
  res.json({ message: "Notifications are off for this device." });
}));

module.exports = router;
