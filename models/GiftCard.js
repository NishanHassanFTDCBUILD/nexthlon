const mongoose = require('mongoose');

// A gift card bought from the store. It is issued once, when its order is paid, and each code is used once:
// redeeming it moves its value into the buyer's wallet (services/giftCardService.js).
const giftCardSchema = new mongoose.Schema(
  {
    code: {type: String, required: true, unique: true, trim: true},
    amount: {type: Number, required: true, min: 1},
    status: {
      type: String,
      enum: ['active', 'redeemed', 'disabled'],
      default: 'active',
      index: true,
    },
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      default: null,
      index: true,
    },
    purchaser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    redeemedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    redeemedAt: {type: Date, default: null},
    expiresAt: {type: Date, required: true, index: true},
  },
  {timestamps: true},
);

module.exports = mongoose.model('GiftCard', giftCardSchema);
