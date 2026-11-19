const mongoose = require('mongoose');

// A customer's own named list ("Gym kit", "Running"). The default wishlist stays in Wishlist.
// A list can be shared read-only through a random id; the public page never shows who owns it.
const shoppingListSchema = new mongoose.Schema(
  {
    user: {type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true},
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 40,
    },
    products: {
      type: [{type: mongoose.Schema.Types.ObjectId, ref: 'Product'}],
      default: [],
    },
    shareId: {type: String}, // set the first time the list is shared; absent until then
    isShared: {type: Boolean, default: false},
  },
  {timestamps: true},
);

shoppingListSchema.index({user: 1, createdAt: 1});
// Only lists that have a share id are in this index (an unset or null id is never a duplicate).
shoppingListSchema.index(
  {shareId: 1},
  {unique: true, partialFilterExpression: {shareId: {$type: 'string'}}},
);

module.exports = mongoose.model('ShoppingList', shoppingListSchema);
