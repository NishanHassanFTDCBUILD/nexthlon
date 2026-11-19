const mongoose = require('mongoose');

// A signed-in customer asked to hear when a product's price drops. `price` is the price the customer
// was last told about (or the price when they asked): an email goes out only when the price is lower.
const priceWatchSchema = new mongoose.Schema(
  {
    user: {type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true},
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },
    price: {type: Number, required: true, min: 0},
  },
  {timestamps: true},
);

priceWatchSchema.index({user: 1, product: 1}, {unique: true});
// The sweep looks at products by their watches.
priceWatchSchema.index({product: 1});

module.exports = mongoose.model('PriceWatch', priceWatchSchema);
