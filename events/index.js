// "Something happened": an order was placed, shipped, refunded... The code that makes it happen only says so
// (emit); everything that should follow (an email, a stock alert) is a listener
// registered elsewhere. So adding a reaction never means editing the order code, and a reaction that fails
// can never fail the order.
//
// Each listener runs as a job (jobs/queue.js): saved in MongoDB, retried with growing waits, and not lost if
// the server restarts. Emit AFTER the change is saved, and pass ids, not documents: the listener loads the
// current data when it runs.
//
//   events.on("order.placed", "email", async ({ orderId }) => { ... });   // once, at start-up
//   events.emit("order.placed", { orderId }, { key: orderId });          // where it happens
//
// key: the same event with the same key is queued once (a retry or a double click cannot send two emails).
const queue = require('../jobs/queue');
const registry = require('../jobs/registry');
const logger = require('../utils/logger');

const listeners = new Map();
const jobType = (event, name) => `event:${event}:${name}`;

function on(event, name, handler, {maxAttempts = 6} = {}) {
  registry.register(jobType(event, name), handler, {maxAttempts});
  if (!listeners.has(event)) listeners.set(event, new Map());
  listeners.get(event).set(name, {maxAttempts});
}

// Queues one job per listener. Never throws: the order has already happened, and the caller must not fail
// because a reaction could not be queued (it is logged, and the listener's work is simply not done).
async function emit(event, payload = {}, {key} = {}) {
  const subscribed = listeners.get(event);
  if (!subscribed) return true;
  let queued = true;
  for (const [name, {maxAttempts}] of subscribed) {
    const type = jobType(event, name);
    try {
      await queue.enqueue(type, payload, {
        maxAttempts,
        ...(key ? {dedupeKey: `${type}:${key}`} : {}),
      });
    } catch (error) {
      queued = false;
      logger.error('event.enqueue_failed', {event, listener: name, error});
    }
  }
  return queued;
}

const hasListeners = (event) => listeners.has(event);

module.exports = {on, emit, hasListeners, jobType};
