// Runs work after the reply has gone out, for things the visitor should not wait for or learn anything
// from (sending an email). A failure is logged, never thrown into the request.
//
// It also keeps the answer to "do we reply faster when the account does not exist?" the same for both:
// the forgot-password request does its lookups and email in here, so the reply takes the same time
// whether or not the address has an account.
const logger = require('./logger');

const running = new Set();

function background(event, work) {
  const task = Promise.resolve()
    .then(work)
    .catch((error) => logger.warn(`${event}.failed`, {error}))
    .finally(() => running.delete(task));
  running.add(task);
  return task;
}

// Resolves when everything started so far has finished (tests use it, and so can a graceful shutdown).
async function idle() {
  while (running.size) await Promise.allSettled([...running]);
}

module.exports = {background, idle};
