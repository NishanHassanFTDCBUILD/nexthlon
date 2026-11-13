const mongoose = require("mongoose");
const { priceFor } = require("../utils/pricing");

// One product, one price. It may have options (sizes, colours), each with its own SKU and stock; then the
// product's stock is the sum of its options, kept in step on every save and every stock change
// (services/stockService.js), so lists, filters and reports keep reading one number. Without options a
// product is one item with one stock count, as before.
// All money is in paise. "price" is what the shopper pays: basePrice after the better of the product
// offer and the category offer. It is worked out on save (the hook below), never taken from a form.
// utils/pricing.js PRICE_PIPELINE does the same sums as a database update, for many at once.

// One option: a size and/or a colour, its SKU and its stock. Its _id is what carts and orders refer to.
const variantSchema = new mongoose.Schema({
  size: { type: String, trim: true, default: "", maxlength: 20 },
  colour: { type: String, trim: true, default: "", maxlength: 30 },
  sku: { type: String, trim: true, default: "", maxlength: 40 },
  stock: { type: Number, required: true, min: 0, validate: Number.isInteger }
});

const productSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 160 },
  slug: { type: String, required: true, unique: true, trim: true, lowercase: true },
  category: { type: mongoose.Schema.Types.ObjectId, ref: "Category", required: true, index: true },
  brand: { type: String, trim: true, default: "Nexthlon", maxlength: 60 },
  basePrice: { type: Number, required: true, min: 0, validate: Number.isInteger },
  mrp: { type: Number, required: true, min: 0, validate: Number.isInteger },
  offerPercent: { type: Number, default: 0, min: 0, max: 90, validate: Number.isInteger },
  // Copied from the category, so lists can filter and sort on the final price in one query.
  categoryOffer: { type: Number, default: 0, min: 0, max: 90 },
  categoryListed: { type: Boolean, default: true },
  bestOffer: { type: Number, default: 0 },
  price: { type: Number, required: true, min: 0 },
  discountPercent: { type: Number, default: 0, min: 0, max: 100 },
  stock: { type: Number, required: true, min: 0, validate: Number.isInteger },
  // Sizes and colours (empty: the product has none). See the note at the top.
  variants: { type: [variantSchema], default: [] },
  // The main photo. gallery holds every photo in order, with the main one first.
  image: { type: String, required: true, trim: true },
  gallery: { type: [String], default: [] },
  // Which photos show which colour: picking "Black" on the product page shows the Black photos (and any
  // photo with no colour). Each image is one of the gallery's addresses.
  colourPhotos: {
    type: [new mongoose.Schema({
      image: { type: String, required: true, trim: true },
      colour: { type: String, required: true, trim: true, maxlength: 30 }
    }, { _id: false })],
    default: []
  },
  description: { type: String, default: "", maxlength: 4000 },
  highlights: { type: [String], default: [] },
  specs: { type: Map, of: String, default: {} },
  ratingAverage: { type: Number, default: 0, min: 0, max: 5 },
  ratingCount: { type: Number, default: 0, min: 0 },
  // Soft delete: unlisted products vanish from the store but stay in the database.
  isListed: { type: Boolean, default: true },
  // Marks documents whose money is in paise (older ones stored rupees; see the migration below).
  pricesInPaise: { type: Boolean, default: true }
}, { timestamps: true });

productSchema.index({ isListed: 1, categoryListed: 1, category: 1, price: 1 });
productSchema.index({ isListed: 1, categoryListed: 1, discountPercent: -1 });
productSchema.index({ isListed: 1, categoryListed: 1, ratingAverage: -1 });
productSchema.index({ isListed: 1, categoryListed: 1, createdAt: -1 });
// The size filter on listings ("available in size 9").
productSchema.index({ isListed: 1, categoryListed: 1, "variants.size": 1 });
productSchema.index({ brand: 1 });
// Server-side text search. A match in the name counts most, then the brand, then the description.
productSchema.index(
  { name: "text", brand: "text", description: "text" },
  { name: "product_text", weights: { name: 10, brand: 5, description: 1 }, default_language: "english" }
);

// With options, the product's stock is always the sum of its options' stock.
productSchema.pre("validate", function sumOptionStock(next) {
  if (this.variants && this.variants.length) this.stock = this.variants.reduce((sum, v) => sum + (Number(v.stock) || 0), 0);
  next();
});

productSchema.pre("validate", function setPrices(next) {
  if (Number.isFinite(this.basePrice) && Number.isFinite(this.mrp)) {
    const result = priceFor(this);
    this.price = result.price;
    this.bestOffer = result.bestOffer;
    this.discountPercent = result.discountPercent;
  }
  next();
});

// Any change to a product (an admin edit, stock going down with an order, a price offer) clears the
// short-lived catalogue cache (utils/memo.js), so this server shows it on the very next page.
// Other servers catch up when their copy runs out (30 seconds at most).
const memo = require("../utils/memo");
const forgetCatalog = () => memo.forget("catalog:");
productSchema.post("save", forgetCatalog);
productSchema.post(["updateOne", "updateMany", "findOneAndUpdate", "deleteOne", "deleteMany", "findOneAndDelete", "replaceOne"], forgetCatalog);
productSchema.post("deleteOne", { document: true, query: false }, forgetCatalog);
productSchema.post("insertMany", forgetCatalog);
productSchema.post("bulkWrite", forgetCatalog);

module.exports = mongoose.model("Product", productSchema);
