const mongoose = require('mongoose');
const {CONTACT_TOPICS} = require('../config/store');

// A message sent from the contact page. "user" is set when a signed-in shopper sends it.
const contactMessageSchema = new mongoose.Schema(
  {
    name: {type: String, required: true, trim: true, maxlength: 60},
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 254,
    },
    phone: {type: String, trim: true, default: ''},
    topic: {type: String, required: true, enum: CONTACT_TOPICS},
    message: {type: String, required: true, maxlength: 2000},
    user: {type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null},
    status: {type: String, enum: ['new', 'read', 'closed'], default: 'new'},
  },
  {timestamps: true},
);

contactMessageSchema.index({status: 1, createdAt: -1});

module.exports = mongoose.model('ContactMessage', contactMessageSchema);
