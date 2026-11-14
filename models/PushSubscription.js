const mongoose = require("mongoose");

// One browser or phone that agreed to notifications (E5). The endpoint is the address the browser's push
// service gave us; it stops working when the person turns notifications off, and is then removed.
const pushSubscriptionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  endpoint: { type: String, required: true, unique: true, maxlength: 1000 },
  keys: {
    p256dh: { type: String, required: true, maxlength: 200 },
    auth: { type: String, required: true, maxlength: 100 }
  },
  device: { type: String, default: "", maxlength: 80 },
  lastSentAt: { type: Date, default: null }
}, { timestamps: true });

module.exports = mongoose.model("PushSubscription", pushSubscriptionSchema);
