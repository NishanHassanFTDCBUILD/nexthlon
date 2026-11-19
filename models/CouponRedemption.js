const mongoose = require('mongoose');

// One row each time a coupon is used on an order. Counting a customer's rows enforces the
// per-customer limit; the row is removed again if that order is cancelled or never paid.
const couponRedemptionSchema = new mongoose.Schema(
  {
    coupon: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Coupon',
      required: true,
    },
    user: {type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true},
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      required: true,
      unique: true,
    },
    code: {type: String, required: true},
    discount: {type: Number, default: 0, min: 0},
  },
  {timestamps: true},
);

couponRedemptionSchema.index({coupon: 1, user: 1});

module.exports = mongoose.model('CouponRedemption', couponRedemptionSchema);
