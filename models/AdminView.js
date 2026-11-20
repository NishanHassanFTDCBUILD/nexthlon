const mongoose = require('mongoose');

// A saved list view: the filters of one admin list (its path and query string), kept under a name by
// one admin. Personal to that admin; nothing here is shown to customers.
const adminViewSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    path: {type: String, required: true, maxlength: 120},
    name: {type: String, required: true, trim: true, maxlength: 40},
    query: {type: String, default: '', maxlength: 600},
  },
  {timestamps: true},
);

adminViewSchema.index({user: 1, path: 1, createdAt: 1});

module.exports = mongoose.model('AdminView', adminViewSchema);
