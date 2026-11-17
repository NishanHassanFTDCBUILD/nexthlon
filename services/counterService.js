// Named running numbers, e.g. "order-2026" → 123 for order NX-2026-000123.
// $inc on one document is atomic, so two callers can never get the same number.
const Counter = require("../models/Counter");

async function nextNumber(name) {
  const counter = await Counter.findOneAndUpdate({ _id: name }, { $inc: { seq: 1 } }, { upsert: true, new: true });
  return counter.seq;
}

// Increment and remember the number in one counter update. A lost response or a
// second worker receives the same number, without consuming another slot.
async function numberFor(name, key) {
  const hash = require("crypto").createHash("sha256").update(String(key)).digest("hex");
  const field = `allocations.${hash}`;
  const pipeline = [
    { $set: { seq: { $cond: [{ $ne: [{ $type: `$${field}` }, "missing"] }, "$seq", { $add: [{ $ifNull: ["$seq", 0] }, 1] }] } } },
    { $set: { [field]: { $ifNull: [`$${field}`, "$seq"] } } }
  ];
  let counter;
  try {
    counter = await Counter.findOneAndUpdate({ _id: name }, pipeline, { upsert: true, new: true });
  } catch (error) {
    if (error.code !== 11000) throw error;
    counter = await Counter.findOneAndUpdate({ _id: name }, pipeline, { new: true });
  }
  return counter.allocations.get(hash);
}

module.exports = { nextNumber, numberFor };
