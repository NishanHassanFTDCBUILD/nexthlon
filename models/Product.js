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
  image: { type: String, required: true, trim: true },
  gallery: { type: [String], default: [] },
  description: { type: String, default: "", maxlength: 4000 },
  highlights: { type: [String], default: [] },
  specs: { type: Map, of: String, default: {} },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

productSchema.index({ isActive: 1, category: 1, price: 1 });

function discountFor(price, mrp) {
  return mrp > price ? Math.round(((mrp - price) / mrp) * 100) : 0;
}

productSchema.pre("save", function setDiscount(next) {
  this.discountPercent = discountFor(this.price, this.mrp);
  next();
});

const Product = mongoose.model("Product", productSchema);
Product.discountFor = discountFor;

module.exports = Product;
