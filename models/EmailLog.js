const mongoose = require('mongoose');

// Which emails have been sent, so a retried job (or a restart in the middle of one) never sends the same
// email twice. The key says what the email is about: "order:NX-2026-000123:status:shipped".
const emailLogSchema = new mongoose.Schema(
  {
    key: {type: String, required: true, unique: true},
    kind: {type: String, default: ''},
    to: {type: String, default: ''},
    orderId: {type: String, default: ''},
    // A worker is sending it right now (so another one waits); cleared by finishing.
    claimedAt: {type: Date, default: null},
    sentAt: {type: Date, default: null},
    provider: {type: String, default: ''},
    providerId: {type: String, default: ''},
  },
  {timestamps: true},
);

emailLogSchema.index({orderId: 1}, {sparse: true});
// A year is plenty to answer "did this customer get the shipping email?".
emailLogSchema.index({createdAt: 1}, {expireAfterSeconds: 365 * 24 * 60 * 60});

module.exports = mongoose.model('EmailLog', emailLogSchema);
