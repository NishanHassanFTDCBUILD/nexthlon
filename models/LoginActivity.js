const mongoose = require('mongoose');

// One row per successful sign-in: when, which browser, and a masked IP address.
// Only the last 10 are kept per customer (loginActivityService prunes older rows).
const loginActivitySchema = new mongoose.Schema({
  user: {type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true},
  browser: {type: String, default: 'Unknown browser', maxlength: 80},
  ip: {type: String, default: '', maxlength: 60}, // already masked, e.g. 103.21.x.x
  at: {type: Date, default: Date.now},
});

loginActivitySchema.index({user: 1, at: -1});

module.exports = mongoose.model('LoginActivity', loginActivitySchema);
