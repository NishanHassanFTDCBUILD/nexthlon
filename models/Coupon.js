const mongoose = require('mongoose');

// A discount code. Amounts are in paise; "value" is paise for a flat coupon and a whole
// percent for a percent coupon. 0 for maxDiscount or usageLimit means "no limit".
const couponSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      match: /^[A-Z0-9]{3,20}$/,
    },
    description: {type: String, default: '', trim: true, maxlength: 140},
    type: {type: String, enum: ['flat', 'percent'], required: true},
    value: {type: Number, required: true, min: 1, validate: Number.isInteger},
    maxDiscount: {type: Number, default: 0, min: 0, validate: Number.isInteger},
    minOrder: {type: Number, default: 0, min: 0, validate: Number.isInteger},
    startsAt: {type: Date, default: null},
    endsAt: {type: Date, default: null},
    usageLimit: {type: Number, default: 0, min: 0, validate: Number.isInteger},
    perUserLimit: {
      type: Number,
      default: 1,
      min: 0,
      validate: Number.isInteger,
    },
    usedCount: {type: Number, default: 0, min: 0},
    // The enable/disable toggle in the admin console.
    isActive: {type: Boolean, default: true},
    // Soft delete: the coupon can never be used again, but the orders that used it keep their
    // history (see models/CouponRedemption.js). It is simply hidden from the admin list.
    isDeleted: {type: Boolean, default: false},
    deletedAt: {type: Date, default: null},
  },
  {timestamps: true},
);

couponSchema.path('value').validate(function checkPercent(value) {
  return this.type !== 'percent' || value <= 90;
}, 'A percent coupon can be at most 90%.');

couponSchema.index({isActive: 1, endsAt: 1});
couponSchema.index({createdAt: -1});
couponSchema.index({isDeleted: 1, createdAt: -1});

module.exports = mongoose.model('Coupon', couponSchema);
