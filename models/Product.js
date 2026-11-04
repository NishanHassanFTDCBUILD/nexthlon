const mongoose = require("mongoose");
const { priceFor } = require("../utils/pricing");

// One product = one item with one price and one stock count. No sizes or colours.
// All money is in paise. "price" is what the shopper pays: basePrice after the better of the
// product offer and the category offer. It is worked out here, never taken from a form.
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
  // The main photo. gallery holds every photo in order, with the main one first.
  image: { type: String, required: true, trim: true },
  gallery: { type: [String], default: [] },
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
productSchema.index({ brand: 1 });
// Server-side text search. A match in the name counts most, then the brand, then the description.
productSchema.index(
  { name: "text", brand: "text", description: "text" },
  { name: "product_text", weights: { name: 10, brand: 5, description: 1 }, default_language: "english" }
);

function discountFor(price, mrp) {
  return mrp > price ? Math.round(((mrp - price) / mrp) * 100) : 0;
}

productSchema.pre("validate", function setPrices(next) {
  if (Number.isFinite(this.basePrice) && Number.isFinite(this.mrp)) {
    const result = priceFor(this);
    this.price = result.price;
    this.bestOffer = result.bestOffer;
    this.discountPercent = result.discountPercent;
  }
  next();
});

// The same sums as utils/pricing.js, written as a database update, for changing many products at once.
const half = expr => ({ $floor: { $add: [expr, 0.5] } });
const RECOMPUTE = [
  { $set: { bestOffer: { $max: [{ $ifNull: ["$offerPercent", 0] }, { $ifNull: ["$categoryOffer", 0] }] } } },
  { $set: { price: half({ $divide: [{ $multiply: ["$basePrice", { $subtract: [100, "$bestOffer"] }] }, 100] }) } },
  {
    $set: {
      discountPercent: {
        $cond: [{ $gt: ["$mrp", "$price"] }, half({ $multiply: [{ $divide: [{ $subtract: ["$mrp", "$price"] }, "$mrp"] }, 100] }), 0]
      }
    }
  }
];

const Product = mongoose.model("Product", productSchema);
Product.discountFor = discountFor;
// Only listed products in listed categories are ever shown to shoppers.
Product.LISTED = Object.freeze({ isListed: true, categoryListed: true });

// A category's offer or visibility changed: copy it onto its products and redo their prices.
Product.syncCategory = function syncCategory(category) {
  return Product.updateMany({ category: category._id }, [
    { $set: { categoryOffer: category.offerPercent || 0, categoryListed: category.isListed !== false } },
    ...RECOMPUTE
  ]);
};

// ---------- One-time upgrades for products saved by older versions ----------

// Products saved before the isListed flag used "isActive". Copies the old value across once.
Product.migrateListedFlag = async function migrateListedFlag() {
  await Product.collection.updateMany(
    { isListed: { $exists: false } },
    [{ $set: { isListed: { $ne: ["$isActive", false] } } }, { $unset: "isActive" }]
  );
};

// Older products stored whole rupees in "price" and "mrp". Converts them to paise once:
// the old price becomes the base price, and the offer fields start at 0.
Product.migrateToPaise = async function migrateToPaise() {
  await Product.collection.updateMany({ pricesInPaise: { $ne: true } }, [
    {
      $set: {
        basePrice: half({ $multiply: ["$price", 100] }),
        mrp: half({ $multiply: ["$mrp", 100] }),
        offerPercent: { $ifNull: ["$offerPercent", 0] },
        categoryOffer: { $ifNull: ["$categoryOffer", 0] },
        categoryListed: { $ifNull: ["$categoryListed", true] },
        ratingAverage: { $ifNull: ["$ratingAverage", 0] },
        ratingCount: { $ifNull: ["$ratingCount", 0] },
        pricesInPaise: true
      }
    },
    ...RECOMPUTE
  ]);
};

module.exports = Product;
