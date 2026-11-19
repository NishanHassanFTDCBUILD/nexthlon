const mongoose = require('mongoose');

// "Buy now": one product the customer wants to check out on its own, kept apart from the cart
// (Amazon-style), so buying it never changes what is in the cart. One per customer; a new
// Buy now replaces it. MongoDB deletes it by itself once expiresAt has passed.
// Prices are never stored here; they always come live from the product.
const buyNowSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },
    // The chosen size or colour (models/Product.js variants), for products that have them.
    variant: {type: mongoose.Schema.Types.ObjectId, default: null},
    quantity: {
      type: Number,
      required: true,
      min: 1,
      validate: Number.isInteger,
    },
    // The coupon chosen on the Buy now checkout (separate from the cart's coupon).
    couponCode: {type: String, default: ''},
    expiresAt: {type: Date, required: true},
  },
  {timestamps: true},
);

buyNowSchema.index({expiresAt: 1}, {expireAfterSeconds: 0});

module.exports = mongoose.model('BuyNow', buyNowSchema);
