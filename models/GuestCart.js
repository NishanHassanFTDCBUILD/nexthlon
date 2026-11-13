const mongoose = require("mongoose");

// A cart for someone who has not signed in yet (Amazon-style: browse, add, and only sign in at checkout).
// The browser holds a random token in an httpOnly cookie (middleware/guestCart.js); only its SHA-256
// hash is stored here, so a copy of the database cannot be used to take over anyone's cart.
// At sign-in or sign-up the items move into the account's cart (cartService.mergeGuestCart) and this
// document is deleted. Prices are never stored: they always come live from the product.
const guestItemSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
  // The chosen size or colour (models/Product.js variants), for products that have them.
  variant: { type: mongoose.Schema.Types.ObjectId, default: null },
  quantity: { type: Number, required: true, min: 1, validate: Number.isInteger }
}, { _id: false });

const guestCartSchema = new mongoose.Schema({
  tokenHash: { type: String, required: true, unique: true, match: /^[a-f0-9]{64}$/ },
  items: { type: [guestItemSchema], default: [] }
}, { timestamps: true });

// A guest cart nobody has touched for 30 days is removed by MongoDB itself.
guestCartSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

module.exports = mongoose.model("GuestCart", guestCartSchema);
