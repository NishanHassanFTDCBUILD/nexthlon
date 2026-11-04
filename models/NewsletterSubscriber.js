const mongoose = require("mongoose");

// One row per email address that signed up from the footer newsletter box.
const newsletterSubscriberSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, trim: true, lowercase: true, maxlength: 254 }
}, { timestamps: true });

module.exports = mongoose.model("NewsletterSubscriber", newsletterSubscriberSchema);
