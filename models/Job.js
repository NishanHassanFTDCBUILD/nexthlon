const mongoose = require("mongoose");

// One unit of background work: "send this email", "remind this cart". Kept in MongoDB (no extra service to
// run), so a job survives a restart and a deploy. See jobs/queue.js and jobs/worker.js.
//
//   queued   waiting for runAt
//   running  a worker holds it until lockedUntil; if that worker dies, the lease runs out and another takes over
//   done     finished (kept 7 days, then MongoDB removes it)
//   failed   gave up after maxAttempts, or failed in a way that cannot get better (kept 30 days for a look)
const jobSchema = new mongoose.Schema({
  type: { type: String, required: true },
  // JSON only: ids as strings, never documents. The handler loads fresh data, so a retry sees today's state.
  payload: { type: mongoose.Schema.Types.Mixed, default: {} },
  status: { type: String, enum: ["queued", "running", "done", "failed"], default: "queued" },
  runAt: { type: Date, default: Date.now },
  attempts: { type: Number, default: 0 },
  maxAttempts: { type: Number, default: 6, min: 1 },
  lastError: { type: String, default: "", maxlength: 500 },
  lockedUntil: { type: Date, default: null },
  lockedBy: { type: String, default: "" },
  // Asking for the same job twice (the same status change reported twice) makes only one.
  dedupeKey: { type: String },
  finishedAt: { type: Date, default: null },
  deleteAt: { type: Date, default: null }
}, { timestamps: true });

// What a worker asks for: due queued jobs, and running ones whose lease has run out.
jobSchema.index({ status: 1, runAt: 1 });
jobSchema.index({ status: 1, lockedUntil: 1 });
jobSchema.index({ dedupeKey: 1 }, { unique: true, partialFilterExpression: { dedupeKey: { $type: "string" } } });
jobSchema.index({ deleteAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("Job", jobSchema);
