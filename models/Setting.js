const mongoose = require('mongoose');

// Store settings the admin can change, one document per key (for example "referralReward").
const settingSchema = new mongoose.Schema(
  {
    key: {type: String, required: true, unique: true},
    value: {type: mongoose.Schema.Types.Mixed, required: true},
  },
  {timestamps: true},
);

module.exports = mongoose.model('Setting', settingSchema);
