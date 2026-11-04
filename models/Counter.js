const mongoose = require("mongoose");

// Named running numbers, e.g. { _id: "order-2026", seq: 123 } for order NX-2026-000123.
// $inc on one document is atomic, so two orders can never get the same number.
const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 }
}, { versionKey: false });

const Counter = mongoose.model("Counter", counterSchema);

Counter.next = async function next(name) {
  const counter = await Counter.findOneAndUpdate({ _id: name }, { $inc: { seq: 1 } }, { upsert: true, new: true });
  return counter.seq;
};

module.exports = Counter;
