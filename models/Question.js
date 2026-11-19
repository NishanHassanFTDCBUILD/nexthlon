const mongoose = require('mongoose');

// Product questions and answers (E3). Any signed-in customer may ask; customers who received the product
// and the store's team may answer. Hidden ones (by an admin) stay for the record but are never shown.
const answerSchema = new mongoose.Schema({
  body: {type: String, required: true, trim: true, maxlength: 1000},
  user: {type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null},
  authorName: {type: String, required: true, maxlength: 40},
  // "Nexthlon team" answers, and answers from buyers who received the product, are marked as such.
  isStaff: {type: Boolean, default: false},
  verifiedBuyer: {type: Boolean, default: false},
  at: {type: Date, default: Date.now},
});

const questionSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },
    user: {type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true},
    authorName: {type: String, required: true, maxlength: 40},
    body: {
      type: String,
      required: true,
      trim: true,
      minlength: 10,
      maxlength: 300,
    },
    answers: {
      type: [answerSchema],
      default: [],
      validate: (list) => list.length <= 20,
    },
    answerCount: {type: Number, default: 0},
    isHidden: {type: Boolean, default: false},
  },
  {timestamps: true},
);

questionSchema.index({product: 1, isHidden: 1, answerCount: -1, createdAt: -1});
// The admin's "waiting for an answer" list.
questionSchema.index({answerCount: 1, isHidden: 1, createdAt: -1});
questionSchema.index({product: 1, user: 1});

module.exports = mongoose.model('Question', questionSchema);
