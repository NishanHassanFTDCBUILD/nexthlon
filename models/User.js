const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 60,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
    },
    passwordHash: {type: String, required: true, select: false},
    phone: {type: String, trim: true, default: ''},
    role: {
      type: String,
      enum: ['customer', 'admin'],
      default: 'customer',
      index: true,
    },
    // Admin accounts only: what this admin may do (utils/permissions.js). Empty means owner.
    adminRole: {
      type: String,
      enum: [
        'owner',
        'manager',
        'catalogue',
        'packing',
        'support',
        'finance',
        '',
      ],
      default: '',
    },
    isBlocked: {type: Boolean, default: false, index: true},
    // A private note the team keeps on a customer. Never shown to the customer.
    adminNote: {type: String, default: '', maxlength: 1000},
    // Copied into every token. Changing the password adds 1, so all older tokens stop working.
    tokenVersion: {type: Number, default: 0},
    lastLoginAt: {type: Date, default: null},
    // When the customer confirmed this email address from the link we sent (null: not confirmed yet).
    // Changing the email clears it, and a password reset by email sets it (the link proved the address).
    emailVerifiedAt: {type: Date, default: null},
    // Every customer has a code to invite friends; referredBy is set once, at sign-up.
    referralCode: {type: String, uppercase: true, trim: true},
    referredBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    // What the customer wants to hear about (saved from the account's notification page).
    notifyPrefs: {
      orderUpdates: {type: Boolean, default: true},
      offers: {type: Boolean, default: true},
      newsletter: {type: Boolean, default: false},
      // E1: order updates on WhatsApp too (to the phone on the delivery address). Off until the customer says yes.
      whatsapp: {type: Boolean, default: false},
    },
    // The last products this customer looked at, newest first (kept to RECENT_LIMIT).
    // E2: phones confirmed with a code for Cash on Delivery ("919876543210"), so they are not asked again soon.
    verifiedPhones: {
      type: [new mongoose.Schema({phone: String, at: Date}, {_id: false})],
      default: [],
      select: false,
    },
    recentlyViewed: {
      type: [
        {
          product: {type: mongoose.Schema.Types.ObjectId, ref: 'Product'},
          at: {type: Date, default: Date.now},
          _id: false,
        },
      ],
      default: [],
    },
    // Soft delete: the account can no longer sign in, but its orders stay for the store's records.
    isDeleted: {type: Boolean, default: false, index: true},
    deletedAt: {type: Date, default: null},
  },
  {timestamps: true},
);

userSchema.index({referralCode: 1}, {unique: true, sparse: true});

// What the browser may see of a user: utils/publicUser.js.

module.exports = mongoose.model('User', userSchema);
