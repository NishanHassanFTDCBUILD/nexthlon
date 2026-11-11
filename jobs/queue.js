// The job queue, on MongoDB. enqueue() adds work; the worker (jobs/worker.js) claims, runs and settles it.
const os = require("os");
const crypto = require("crypto");
const Job = require("../models/Job");
const logger = require("../utils/logger");

const SECOND = 1000;
const DAY = 24 * 60 * 60 * 1000;
// How long a worker may hold a job before another may take it (a worker that died mid-job).
const LEASE_MS = 5 * 60 * SECOND;
const KEEP_DONE_MS = 7 * DAY;
const KEEP_FAILED_MS = 30 * DAY;
const MAX_ERROR = 500;

const workerId = `${os.hostname()}:${process.pid}:${crypto.randomBytes(3).toString("hex")}`;

// Adds a job. With a dedupeKey, asking again returns the job already there instead of making a second.
async function enqueue(type, payload = {}, { runAt = new Date(), maxAttempts = 6, dedupeKey } = {}) {
  try {
    return await Job.create({ type, payload, runAt, maxAttempts, ...(dedupeKey ? { dedupeKey } : {}) });
  } catch (error) {
    if (error.code === 11000 && dedupeKey) return Job.findOne({ dedupeKey });
    throw error;
  }
}

// Takes the next due job for this worker, or null. One atomic step, so two workers never get the same job.
// A "running" job whose lease ran out (its worker died) counts as due again.
async function claim(now = new Date()) {
  return Job.findOneAndUpdate(
    { $or: [{ status: "queued", runAt: { $lte: now } }, { status: "running", lockedUntil: { $lt: now } }] },
    { $set: { status: "running", lockedUntil: new Date(now.getTime() + LEASE_MS), lockedBy: workerId }, $inc: { attempts: 1 } },
    { sort: { runAt: 1 }, new: true }
  );
}

// How long to wait before attempt N+1: 30 seconds, 2 minutes, 8 minutes, 32 minutes, then 2 hours, give or take 20%
// (so a hundred jobs that failed together do not all come back at the same second).
function backoffMs(attempts, random = Math.random) {
  const base = Math.min(2 * 60 * 60 * SECOND, 30 * SECOND * 4 ** (attempts - 1));
  return Math.round(base * (0.8 + random() * 0.4));
}

const shorten = error => String((error && error.message) || error).slice(0, MAX_ERROR);

async function complete(job, now = new Date()) {
  await Job.updateOne({ _id: job._id }, { $set: { status: "done", finishedAt: now, deleteAt: new Date(now.getTime() + KEEP_DONE_MS), lockedUntil: null, lastError: "" } });
}

// Failed: try again later, or give up when the error says it cannot get better or the attempts are used up.
async function fail(job, error, now = new Date()) {
  const permanent = Boolean(error && error.permanent);
  if (permanent || job.attempts >= job.maxAttempts) {
    await Job.updateOne({ _id: job._id }, { $set: { status: "failed", finishedAt: now, deleteAt: new Date(now.getTime() + KEEP_FAILED_MS), lockedUntil: null, lastError: shorten(error) } });
    logger.error("job.failed", { type: job.type, id: String(job._id), attempts: job.attempts, permanent, error: shorten(error) });
    return "failed";
  }
  const wait = backoffMs(job.attempts);
  await Job.updateOne({ _id: job._id }, { $set: { status: "queued", runAt: new Date(now.getTime() + wait), lockedUntil: null, lastError: shorten(error) } });
  logger.warn("job.retry", { type: job.type, id: String(job._id), attempt: job.attempts, inSeconds: Math.round(wait / SECOND), error: shorten(error) });
  return "retry";
}

// Counts by state (for the status script and the admin).
async function counts() {
  const rows = await Job.aggregate([{ $group: { _id: "$status", n: { $sum: 1 } } }]);
  return Object.fromEntries(["queued", "running", "done", "failed"].map(status => [status, (rows.find(row => row._id === status) || { n: 0 }).n]));
}

// Puts failed jobs back in the queue (after the cause was fixed).
async function retryFailed(filter = {}) {
  const result = await Job.updateMany({ status: "failed", ...filter }, { $set: { status: "queued", runAt: new Date(), attempts: 0, lastError: "", deleteAt: null } });
  return result.modifiedCount;
}

module.exports = { enqueue, claim, complete, fail, counts, retryFailed, backoffMs, workerId, LEASE_MS };
