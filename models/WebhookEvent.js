const mongoose = require('mongoose');

// Every webhook call we receive (Razorpay payments, Shiprocket tracking), kept so the team can see
// what arrived, whether its signature checked out, what we did with it, and re-run a payment event.
const webhookEventSchema = new mongoose.Schema(
  {
    provider: {type: String, enum: ['razorpay', 'shiprocket'], required: true},
    event: {type: String, default: '', maxlength: 80},
    externalId: {type: String, default: '', maxlength: 80},
    signatureOk: {type: Boolean, default: false},
    outcome: {
      type: String,
      enum: ['processed', 'ignored', 'rejected', 'failed', 'rerun'],
      required: true,
    },
    error: {type: String, default: '', maxlength: 300},
    // Kept only for Razorpay, so an event can be re-run with the same signature. Capped in size.
    rawBody: {type: String, default: '', maxlength: 65536},
    signature: {type: String, default: '', maxlength: 300},
    receivedAt: {type: Date, default: Date.now},
  },
  {timestamps: false},
);

webhookEventSchema.index({receivedAt: -1});
webhookEventSchema.index({provider: 1, outcome: 1, receivedAt: -1});

module.exports = mongoose.model('WebhookEvent', webhookEventSchema);
