const mongoose = require("mongoose");

// Named running numbers, e.g. { _id: "order-2026", seq: 123 } for order NX-2026-000123.
// Read and increment them through services/counterService.js.
const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 }
}, { versionKey: false });

module.exports = mongoose.model("Counter", counterSchema);
