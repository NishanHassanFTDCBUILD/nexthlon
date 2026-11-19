// Whether the server has been asked to stop (a deploy or restart sends SIGTERM). While it is true,
// /readyz answers 503, so the load balancer sends new visitors to another copy and the requests
// already in progress can finish (see server.js).
let shuttingDown = false;

module.exports = {
  isShuttingDown: () => shuttingDown,
  // The argument is only for tests, which switch it back off.
  markShuttingDown: (value = true) => {
    shuttingDown = value;
  },
};
