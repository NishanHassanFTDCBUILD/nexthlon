const mongoose = require('mongoose');

// Kept permanently: an old request must never become a new stock addition.
const schema = new mongoose.Schema(
  {
    actor: {type: mongoose.Schema.Types.ObjectId, required: true},
    requestId: {type: String, required: true},
    fingerprint: {type: String, required: true},
    result: {type: mongoose.Schema.Types.Mixed, required: true},
  },
  {timestamps: true},
);
schema.index({actor: 1, requestId: 1}, {unique: true});
module.exports = mongoose.model('InventoryAdjustment', schema);
