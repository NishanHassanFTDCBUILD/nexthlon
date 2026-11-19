// The job queue, for the team: how many jobs are waiting, running, done or failed, the failed ones
// with their last error, and a retry for a failed job. Jobs themselves are run by the worker (jobs/).
const mongoose = require('mongoose');
const Job = require('../models/Job');
const {HttpError} = require('../utils/http');
const {pageSize} = require('../utils/paging');

const STATUSES = ['all', 'failed', 'queued', 'running', 'done'];

async function summary() {
  const rows = await Job.aggregate([
    {$group: {_id: '$status', count: {$sum: 1}}},
  ]);
  const count = (name) =>
    (rows.find((row) => row._id === name) || {count: 0}).count;
  return {
    queued: count('queued'),
    running: count('running'),
    done: count('done'),
    failed: count('failed'),
  };
}

async function list(query = {}) {
  const status = STATUSES.includes(query.status) ? query.status : 'failed';
  const filter = status === 'all' ? {} : {status};
  const size = pageSize(query, 20);
  const current = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const [rows, total] = await Promise.all([
    Job.find(filter)
      .sort({runAt: -1, _id: -1})
      .skip((current - 1) * size)
      .limit(size)
      .select(
        'type status attempts maxAttempts lastError runAt finishedAt lockedBy',
      )
      .lean(),
    Job.countDocuments(filter),
  ]);
  return {
    jobs: rows.map((j) => ({
      id: String(j._id),
      type: j.type,
      status: j.status,
      attempts: j.attempts,
      maxAttempts: j.maxAttempts,
      lastError: j.lastError || '',
      runAt: j.runAt,
      finishedAt: j.finishedAt,
    })),
    status,
    pagination: {
      page: current,
      pages: Math.max(1, Math.ceil(total / size)),
      total,
      limit: size,
    },
  };
}

// Put a failed job back in the queue to run now, with its attempts reset. Only failed jobs.
async function retry(jobId) {
  if (!mongoose.isValidObjectId(jobId))
    throw new HttpError(404, 'Job not found.');
  const job = await Job.findById(jobId);
  if (!job) throw new HttpError(404, 'Job not found.');
  if (job.status !== 'failed')
    throw new HttpError(409, 'Only a failed job can be retried.');
  const before = {status: job.status, attempts: job.attempts};
  job.status = 'queued';
  job.attempts = 0;
  job.runAt = new Date();
  job.lockedUntil = null;
  job.lockedBy = '';
  await job.save();
  return {type: job.type, before, after: {status: 'queued', attempts: 0}};
}

module.exports = {STATUSES, summary, list, retry};
