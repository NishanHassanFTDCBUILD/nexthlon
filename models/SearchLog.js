const mongoose = require("mongoose");

// What shoppers search for, counted per day: the words (cleaned up), how many times, and how many
// products the last search found. Never who searched (no user, no IP, no cookie). It powers the
// "Trending searches" in the search panel (searchInsightService), and shows which searches find nothing.
// Old days are removed by MongoDB itself after 60 days.
const searchLogSchema = new mongoose.Schema({
  term: { type: String, required: true, maxlength: 60 },
  day: { type: Date, required: true },
  count: { type: Number, default: 0, min: 0 },
  results: { type: Number, default: 0, min: 0 }
}, { timestamps: false, versionKey: false });

searchLogSchema.index({ term: 1, day: 1 }, { unique: true });
searchLogSchema.index({ day: -1, results: 1 });
searchLogSchema.index({ day: 1 }, { expireAfterSeconds: 60 * 24 * 60 * 60 });

module.exports = mongoose.model("SearchLog", searchLogSchema);
