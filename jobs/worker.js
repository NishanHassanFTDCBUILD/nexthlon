// Runs jobs: claims one at a time from the queue (jobs/queue.js), calls its handler (jobs/registry.js),
// and settles it: done, retry later, or failed. Also keeps the repeating jobs (schedules) going.
//
// It runs inside the web server by default, so there is nothing extra to deploy. For a busy store it can
// run on its own too: JOBS_ENABLED=false on the web copies and `npm run worker` somewhere else.
const queue = require("./queue");
const registry = require("./registry");
const logger = require("../utils/logger");

const SCHEDULE_CHECK_MS = 30_000;

// Runs one claimed job and records how it went. Never throws.
async function runOne(job) {
  const entry = registry.handlerFor(job.type);
  if (!entry) return queue.fail(job, Object.assign(new Error(`No handler is registered for "${job.type}"`), { permanent: true }));
  // A job claimed again and again because every worker that took it died: stop feeding it workers.
  if (job.attempts > job.maxAttempts) {
    return queue.fail(job, Object.assign(new Error("Gave up: workers kept stopping while running it"), { permanent: true }));
  }
  try {
    await entry.handler(job.payload || {}, job);
    await queue.complete(job);
    return "done";
  } catch (error) {
    return queue.fail(job, error);
  }
}

// One job per time slot for each schedule, however many copies of the app are running: the slot number is
// part of the job's dedupe key, so the second copy's request finds the first one's job.
async function tickSchedules(now = new Date()) {
  for (const entry of registry.allSchedules()) {
    if (!entry.enabled()) continue;
    const slot = Math.floor(now.getTime() / entry.everyMs);
    await queue.enqueue(entry.type, entry.payload, { dedupeKey: `schedule:${entry.name}:${slot}`, maxAttempts: 2 });
  }
}

function createWorker({ concurrency = 2, pollMs = 1000 } = {}) {
  let running = false;
  let timer = null;
  let lastSchedule = 0;
  const active = new Set();

  async function pump() {
    if (!running) return;
    try {
      if (Date.now() - lastSchedule >= SCHEDULE_CHECK_MS) {
        lastSchedule = Date.now();
        await tickSchedules();
      }
      while (running && active.size < concurrency) {
        const job = await queue.claim();
        if (!job) break;
        const task = runOne(job).finally(() => active.delete(task));
        active.add(task);
      }
    } catch (error) {
      // The database is away for a moment: the next round tries again.
      logger.error("worker.loop_failed", { error });
    } finally {
      if (running) {
        timer = setTimeout(pump, active.size >= concurrency ? 250 : pollMs);
        timer.unref();
      }
    }
  }

  return {
    start() {
      if (running) return;
      running = true;
      logger.info("worker.started", { concurrency, worker: queue.workerId });
      pump();
    },
    // Stops taking new jobs and waits for the ones running (a deploy must not cut an email in half).
    async stop() {
      running = false;
      clearTimeout(timer);
      await Promise.allSettled([...active]);
    },
    isRunning: () => running,
    // Runs every job that is due, then returns how many it ran. For tests and scripts.
    async drain({ maxJobs = 500 } = {}) {
      let ran = 0;
      while (ran < maxJobs) {
        const job = await queue.claim();
        if (!job) break;
        await runOne(job);
        ran += 1;
      }
      return ran;
    }
  };
}

module.exports = { createWorker, runOne, tickSchedules };
