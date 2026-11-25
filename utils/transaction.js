// Runs several database changes as one unit.
// On a replica set (or Atlas) they run inside a MongoDB transaction: all of them happen, or none.
// A single local server has no transactions, so each step registers how to undo itself
// (undo(fn)); if a later step fails, the undo steps run in reverse order.
const mongoose = require('mongoose');
const logger = require('./logger');

let support = null;

async function supportsTransactions() {
  if (support === null) {
    try {
      const hello = await mongoose.connection.db.admin().command({hello: 1});
      support = Boolean(hello.setName || hello.msg === 'isdbgrid');
    } catch {
      return false;
    }
  }
  return support;
}

// work(session, undo): session is null on a single server, where undo(fn) records a rollback step.
async function inTransaction(work) {
  if (await supportsTransactions()) {
    const session = await mongoose.startSession();
    try {
      let result;
      await session.withTransaction(async () => {
        result = await work(session, () => {});
      });
      return result;
    } finally {
      await session.endSession();
    }
  }
  const steps = [];
  try {
    return await work(null, (step) => steps.push(step));
  } catch (error) {
    for (const step of steps.reverse()) {
      try {
        await step();
      } catch (undoError) {
        logger.error('transaction.undo_failed', {error: undoError});
      }
    }
    throw error;
  }
}

module.exports = {supportsTransactions, inTransaction};
