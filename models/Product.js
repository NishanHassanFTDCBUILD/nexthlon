const mongoose = require("mongoose");
const { CATEGORIES } = require("../config/catalog");

// One product = one item with one price and one stock count. No sizes or colours yet.
const productSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 160 },
  slug: { type: String, required: true, unique: true, trim: true, lowercase: true },
  category: { type: String, required: true, enum: CATEGORIES },
  brand: { type: String, trim: true, default: "Nexthlon", maxlength: 60 },
  price: { type: Number, required: true, min: 0 },
  mrp: { type: Number, required: true, min: 0 },
  discountPercent: { type: Number, default: 0, min: 0, max: 100 },
  stock: { type: Number, required: true, min: 0, validate: Number.isInteger },
  // The main photo. gallery holds every photo in order, with the main one first.
  image: { type: String, required: true, trim: true },
  gallery: { type: [String], default: [] },
  description: { type: String, default: "", maxlength: 4000 },
  highlights: { type: [String], default: [] },
  specs: { type: Map, of: String, default: {} },
  // Soft delete: unlisted products vanish from the store but stay in the database.
  isListed: { type: Boolean, default: true }
}, { timestamps: true });

productSchema.index({ isListed: 1, category: 1, price: 1 });

function discountFor(price, mrp) {
  return mrp > price ? Math.round(((mrp - price) / mrp) * 100) : 0;
}

// The discount is always worked out here from price and M.R.P., never taken from a form.
productSchema.pre("save", function setDiscount(next) {
  this.discountPercent = discountFor(this.price, this.mrp);
  next();
});

const Product = mongoose.model("Product", productSchema);
Product.discountFor = discountFor;
// Only listed products are ever shown to shoppers.
Product.LISTED = Object.freeze({ isListed: true });

// Products saved before the isListed flag used "isActive". Copies the old value across once.
Product.migrateListedFlag = async function migrateListedFlag() {
  await Product.collection.updateMany(
    { isListed: { $exists: false } },
    [{ $set: { isListed: { $ne: ["$isActive", false] } } }, { $unset: "isActive" }]
  );
};

module.exports = Product;
