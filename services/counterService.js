// Named running numbers, e.g. "order-2026" → 123 for order NX-2026-000123.
// $inc on one document is atomic, so two callers can never get the same number.
const Counter = require("../models/Counter");

async function nextNumber(name) {
  const counter = await Counter.findOneAndUpdate({ _id: name }, { $inc: { seq: 1 } }, { upsert: true, new: true });
  return counter.seq;
}

module.exports = { nextNumber };
