const mongoose = require('mongoose');

// "Complete the kit" (E6): a set of products sold together with a percent off the set. The shopper adds
// all of them to the cart in one click; prices are still worked out on the server, so the bundle only
// says WHICH products go together and how much the set saves.
const bundleSchema = new mongoose.Schema(
  {
    name: {type: String, required: true, trim: true, maxlength: 80},
    slug: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      maxlength: 90,
    },
    summary: {type: String, trim: true, default: '', maxlength: 200},
    products: {
      type: [{type: mongoose.Schema.Types.ObjectId, ref: 'Product'}],
      validate: (list) => list.length >= 2 && list.length <= 6,
    },
    percentOff: {
      type: Number,
      required: true,
      min: 0,
      max: 30,
      validate: Number.isInteger,
    },
    isActive: {type: Boolean, default: true, index: true},
  },
  {timestamps: true},
);

bundleSchema.index({products: 1, isActive: 1});

module.exports = mongoose.model('Bundle', bundleSchema);
