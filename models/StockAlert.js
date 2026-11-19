const mongoose = require('mongoose');

// "Email me when it's back" (E3): one row per email, product and option (null = any of the product).
// The row stays after the email goes out (notifiedAt), so the same person is not emailed twice for one
// restock; asking again after that starts a new wait.
const stockAlertSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 254,
    },
    user: {type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null},
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },
    variant: {type: mongoose.Schema.Types.ObjectId, default: null},
    notifiedAt: {type: Date, default: null},
  },
  {timestamps: true},
);

stockAlertSchema.index({email: 1, product: 1, variant: 1}, {unique: true});
// The sweep reads the ones still waiting, product by product.
stockAlertSchema.index({notifiedAt: 1, product: 1});
// Old, sent alerts are removed after 90 days.
stockAlertSchema.index(
  {notifiedAt: 1},
  {
    expireAfterSeconds: 90 * 24 * 60 * 60,
    partialFilterExpression: {notifiedAt: {$type: 'date'}},
  },
);

module.exports = mongoose.model('StockAlert', stockAlertSchema);
