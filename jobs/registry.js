// Which function handles which kind of job, and the repeating jobs ("every hour, do this").
// Handlers are registered by jobs/handlers.js (and by events/index.js for event listeners), and the
// worker looks them up by job type.
const handlers = new Map();
const schedules = new Map();

// handler(payload, job) does the work. Throw to retry later (with growing waits); throw an error with
// error.permanent = true when trying again cannot help (the address does not exist, the data is gone).
function register(type, handler, {maxAttempts = 6} = {}) {
  handlers.set(type, {handler, maxAttempts});
}

// A job that should exist at every interval, however many copies of the app run: the queue makes one per
// time slot (see jobs/worker.js). Disabled schedules (enabled() false) are skipped.
function schedule(name, {everyMs, type, payload = {}, enabled = () => true}) {
  schedules.set(name, {name, everyMs, type, payload, enabled});
}

const handlerFor = (type) => handlers.get(type) || null;
const allSchedules = () => [...schedules.values()];

module.exports = {register, schedule, handlerFor, allSchedules};
