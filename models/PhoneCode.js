const mongoose = require('mongoose');

// A one-time code sent to a phone: confirming a Cash on Delivery order, or signing in / up by phone
// (a sign-up code has no user yet). Only a hash of the code is
// kept, it lasts 10 minutes (TTL index), and 5 wrong tries end it.
const phoneCodeSchema = new mongoose.Schema({
  user: {type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null},
  phone: {type: String, required: true},
  purpose: {type: String, enum: ['cod', 'signin', 'signup'], default: 'cod'},
  codeHash: {type: String, required: true},
  attempts: {type: Number, default: 0},
  sentCount: {type: Number, default: 1},
  lastSentAt: {type: Date, default: Date.now},
  expiresAt: {type: Date, required: true},
});

phoneCodeSchema.index({user: 1, phone: 1, purpose: 1}, {unique: true});
phoneCodeSchema.index({expiresAt: 1}, {expireAfterSeconds: 0});

module.exports = mongoose.model('PhoneCode', phoneCodeSchema);
