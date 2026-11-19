// Shows the job queue: how many jobs are waiting, running, done and failed, and why the failed ones failed.
//   npm run jobs:status            list
//   npm run jobs:retry             put every failed job back in the queue
//   npm run jobs:retry -- <type>   only jobs of one type, e.g. event:order.placed:email
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const queue = require('../jobs/queue');
const Job = require('../models/Job');

async function main() {
  await connectDB();
  if (process.argv.includes('--retry')) {
    const type = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
    const count = await queue.retryFailed(type ? {type} : {});
    console.log(`Put ${count} failed job(s) back in the queue.`);
  } else {
    console.log(await queue.counts());
    const failed = await Job.find({status: 'failed'})
      .sort({finishedAt: -1})
      .limit(20)
      .lean();
    failed.forEach((job) =>
      console.log(
        `FAILED ${job.type} (${job.attempts} tries): ${job.lastError}`,
      ),
    );
  }
  await mongoose.disconnect();
}
main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
