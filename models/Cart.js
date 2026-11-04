const mongoose = require("mongoose");

// One cart per customer. Prices shown in the cart always come from the product itself;
// priceAtAdd is only kept to tell the shopper when a price has changed since they added it.
const cartItemSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
  quantity: { type: Number, required: true, min: 1, validate: Number.isInteger },
  priceAtAdd: { type: Number, required: true, min: 0 }
}, { _id: false });

const cartSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
  items: { type: [cartItemSchema], default: [] }
}, { timestamps: true });

module.exports = mongoose.model("Cart", cartSchema);
