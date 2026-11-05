const mongoose = require("mongoose");

// One review per customer per product. Only customers who received the product can write one
// (checked in services/reviewService.js). The product keeps the average, so lists can sort by it.
const reviewSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  // Shown on the review, e.g. "Asha N."; saved once so later name changes do not rewrite history.
  authorName: { type: String, required: true, trim: true, maxlength: 40 },
  rating: { type: Number, required: true, min: 1, max: 5, validate: Number.isInteger },
  title: { type: String, trim: true, default: "", maxlength: 80 },
  body: { type: String, trim: true, required: true, maxlength: 1000 },
  // Hidden by an admin: kept in the database (and in the audit log) but never shown in the store,
  // and left out of the product's average rating.
  isHidden: { type: Boolean, default: false },
  hiddenReason: { type: String, default: "", maxlength: 200 }
}, { timestamps: true });

reviewSchema.index({ product: 1, user: 1 }, { unique: true });
reviewSchema.index({ product: 1, isHidden: 1, createdAt: -1 });
// The admin list: newest first, and filtering by rating or hidden state.
reviewSchema.index({ createdAt: -1 });
reviewSchema.index({ isHidden: 1, createdAt: -1 });

// What the store is allowed to show.
reviewSchema.statics.VISIBLE = Object.freeze({ isHidden: { $ne: true } });

module.exports = mongoose.model("Review", reviewSchema);
