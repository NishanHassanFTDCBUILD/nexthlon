// Remembers which request the running code belongs to, so every log line and error report can carry
// that request's ID without passing it through each function. Uses Node's AsyncLocalStorage.
const { AsyncLocalStorage } = require("node:async_hooks");

const storage = new AsyncLocalStorage();

module.exports = {
  // Runs next() inside a context that holds the request's ID.
  run: (context, fn) => storage.run(context, fn),
  get: () => storage.getStore() || {},
  requestId: () => (storage.getStore() || {}).requestId
};
