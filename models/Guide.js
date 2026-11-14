const mongoose = require("mongoose");

// A sport guide or story for the content hub (E7). Written by the team; only published guides are shown.
const guideSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 120 },
  slug: { type: String, required: true, unique: true, trim: true, lowercase: true, maxlength: 130 },
  summary: { type: String, trim: true, default: "", maxlength: 300 },
  // Paragraphs in order. A paragraph starting with "## " is a heading.
  body: { type: [String], default: [], validate: list => list.length <= 200 },
  tag: { type: String, trim: true, default: "", maxlength: 40 },
  image: { type: String, default: "", maxlength: 500 },
  isPublished: { type: Boolean, default: false, index: true },
  publishedAt: { type: Date, default: null }
}, { timestamps: true });

guideSchema.index({ isPublished: 1, publishedAt: -1 });

module.exports = mongoose.model("Guide", guideSchema);
