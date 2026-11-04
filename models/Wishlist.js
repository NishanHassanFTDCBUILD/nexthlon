const mongoose = require("mongoose");

// One wishlist per customer: the products they saved, newest first.
const wishlistSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
  products: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Product" }], default: [] }
}, { timestamps: true });

module.exports = mongoose.model("Wishlist", wishlistSchema);
