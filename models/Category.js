const mongoose = require("mongoose");

// A sport or product group. Unlisted categories, and every product in them, are hidden from shoppers.
// offerPercent is the category offer; a product gets the higher of its own offer and this one.
const categorySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 40 },
  // Lower-case copy of the name, so "Running" and "running" count as the same category.
  nameKey: { type: String, required: true, unique: true },
  slug: { type: String, required: true, unique: true, trim: true, lowercase: true },
  image: { type: String, trim: true, default: "" },
  description: { type: String, trim: true, default: "", maxlength: 300 },
  offerPercent: { type: Number, default: 0, min: 0, max: 90, validate: Number.isInteger },
  isListed: { type: Boolean, default: true, index: true },
  sortOrder: { type: Number, default: 0 }
}, { timestamps: true });

categorySchema.pre("validate", function setNameKey(next) {
  if (this.name) this.nameKey = this.name.trim().toLowerCase();
  next();
});

const Category = mongoose.model("Category", categorySchema);
Category.LISTED = Object.freeze({ isListed: true });

module.exports = Category;
