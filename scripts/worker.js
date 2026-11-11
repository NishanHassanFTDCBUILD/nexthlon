// Runs background jobs (order emails, cart reminders) on their own, without the website. Use it when the web
// copies run with JOBS_ENABLED=false:   npm run worker
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const config = require("../config/env");
const logger = require("../utils/logger");
require("../jobs/handlers");
const { createWorker } = require("../jobs/worker");

const worker = createWorker({ concurrency: config.jobs.concurrency });
let stopping = false;

async function stop(signal) {
  if (stopping) return;
  stopping = true;
  logger.info("worker.stopping", { signal });
  await worker.stop();
  await mongoose.disconnect();
  process.exit(0);
}

connectDB()
  .then(() => {
    worker.start();
    logger.info("worker.started", { concurrency: config.jobs.concurrency });
  })
  .catch(error => {
    console.error(`Worker failed to start: ${error.message}`);
    process.exit(1);
  });

process.on("SIGTERM", () => stop("SIGTERM"));
process.on("SIGINT", () => stop("SIGINT"));
