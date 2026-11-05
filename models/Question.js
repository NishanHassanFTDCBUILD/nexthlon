const mongoose = require("mongoose");

// Questions & Answers on a product page.
//
// Answers are EMBEDDED in their question: a question is always read with its answers, a thread is
// short, and nothing else ever queries an answer on its own. The question keeps an "answered" flag
// copied from its answers so the admin list can put unanswered questions first in one query.
//
// "Helpful" votes keep the voters' ids, so one customer can only vote once. The list is short in
// practice (a product question gets a handful of votes), and $addToSet makes a repeat vote a no-op.
const answerSchema = new mongoose.Schema({
  body: { type: String, required: true, trim: true, maxlength: 1000 },
  // True when the store answered from the admin console: shown with the official badge.
  byTeam: { type: Boolean, default: false },
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  // Saved once, e.g. "Asha N." or "Nexthlon Team", so later name changes never rewrite history.
  authorName: { type: String, required: true, trim: true, maxlength: 40 },
  helpfulBy: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }], default: [] },
  // Hidden answers stay in the database for the audit trail but are never shown in the store.
  isHidden: { type: Boolean, default: false },
  at: { type: Date, default: Date.now }
});

const questionSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true, index: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  authorName: { type: String, required: true, trim: true, maxlength: 40 },
  body: { type: String, required: true, trim: true, maxlength: 300 },
  answers: { type: [answerSchema], default: [] },
  // Kept in step by questionService.syncAnswered(): true when at least one answer is visible.
  answered: { type: Boolean, default: false, index: true },
  helpfulBy: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }], default: [] },
  isHidden: { type: Boolean, default: false }
}, { timestamps: true });

// The product page: visible questions, newest first.
questionSchema.index({ product: 1, isHidden: 1, createdAt: -1 });
// The admin list: unanswered first, then newest.
questionSchema.index({ answered: 1, createdAt: -1 });
// Searching the questions on a product page, and in the console.
questionSchema.index({ body: "text" }, { name: "question_text", default_language: "english" });

// How many answers a visitor would see (hidden ones do not count).
questionSchema.methods.visibleAnswers = function visibleAnswers() {
  return this.answers.filter(answer => !answer.isHidden);
};

module.exports = mongoose.model("Question", questionSchema);
