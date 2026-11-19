const mongoose = require('mongoose');

// One cart per customer: just products and quantities. Prices are never stored here;
// they always come live from the product.
const cartItemSchema = new mongoose.Schema(
  {
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
  },
  {_id: false},
);

const cartSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    items: {type: [cartItemSchema], default: []},
    // The coupon chosen at checkout. It is checked again every time the totals are worked out.
    couponCode: {type: String, default: ''},
    // Abandoned-cart reminders (admin): when the last one went, and how many so far.
    reminderSentAt: {type: Date, default: null},
    reminderCount: {type: Number, default: 0, min: 0},
  },
  {timestamps: true},
);

// Abandoned carts: carts not touched for a while.
cartSchema.index({updatedAt: 1});

module.exports = mongoose.model('Cart', cartSchema);
