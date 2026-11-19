const mongoose = require('mongoose');

// A Deal of the Day: an extra percent off one product between two moments, chosen by an admin.
// While a deal runs, its percent is copied onto the product (Product.dealOffer) and the product's
// price is worked out again, so the cart, checkout and payment all charge the deal price
// (services/dealService.js syncDealPrices). The best of the product, category and deal offers applies.
const dealSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
      index: true,
    },
    percent: {
      type: Number,
      required: true,
      min: 1,
      max: 90,
      validate: Number.isInteger,
    },
    startsAt: {type: Date, required: true},
    endsAt: {type: Date, required: true},
    isActive: {type: Boolean, default: true},
    // Lower numbers show first in the home page row.
    sortOrder: {type: Number, default: 0},
    // Shown to the admin only.
    note: {type: String, trim: true, default: '', maxlength: 120},
  },
  {timestamps: true},
);

// "Which deals are running now?" is asked every minute by the deal sync job.
dealSchema.index({isActive: 1, startsAt: 1, endsAt: 1});

module.exports = mongoose.model('Deal', dealSchema);
