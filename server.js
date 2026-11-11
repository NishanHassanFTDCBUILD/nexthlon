let config;
try {
  config = require("./config/env");
} catch (error) {
  console.error(`Startup failed: ${error.message}`);
  process.exit(1);
}

const logger = require("./utils/logger");
const monitor = require("./utils/monitor");
const lifecycle = require("./utils/lifecycle");

// Error alerts first, so even a failure while starting is reported (does nothing without SENTRY_DSN).
monitor.init();
config.warnings.forEach(warning => logger.warn("config", { warning }));

const app = require("./app");
const connectDB = require("./config/db");
const mongoose = require("mongoose");

const SHUTDOWN_GRACE_MS = 10_000;
let server;

// A deploy or restart sends SIGTERM (Ctrl+C sends SIGINT). Stop taking new visitors, let the requests
// in progress finish, close the database, then exit. If that takes too long, exit anyway.
async function shutdown(signal) {
  if (lifecycle.isShuttingDown()) return;
  lifecycle.markShuttingDown();
  logger.info("shutdown.start", { signal });
  const force = setTimeout(() => {
    logger.error("shutdown.forced", { after: `${SHUTDOWN_GRACE_MS}ms` });
    process.exit(1);
  }, SHUTDOWN_GRACE_MS);
  force.unref();
  try {
    if (server) {
      // Stops accepting visitors and closes idle connections at once (Node 19+); busy ones finish first.
      await new Promise(resolve => server.close(resolve));
    }
    await mongoose.disconnect();
    await monitor.flush();
    logger.info("shutdown.done");
    process.exit(0);
  } catch (error) {
    logger.error("shutdown.failed", { error });
    process.exit(1);
  }
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Things nothing caught. A promise nobody handled is reported and the app keeps running; an exception
// that escaped everything leaves the app in an unknown state, so it is reported and the process exits
// (the host restarts it).
process.on("unhandledRejection", reason => {
  logger.error("unhandled_rejection", { error: reason, stack: reason && reason.stack });
  monitor.captureException(reason instanceof Error ? reason : new Error(String(reason)));
});
process.on("uncaughtException", async error => {
  logger.error("uncaught_exception", { error, stack: error.stack });
  monitor.captureException(error);
  await monitor.flush();
  process.exit(1);
});

connectDB()
  .then(() => require("./services/migrationService").runMigrations())
  .then(() => {
    // 0.0.0.0: reachable from other devices (a phone on the same network, a container's port).
    server = app.listen(config.port, "0.0.0.0", () => {
      console.log(`Nexthlon running at http://localhost:${config.port}`);
    });

    // Longer than the load balancer's idle timeout (usually 60s), so it never reuses a connection
    // this server has just closed.
    server.keepAliveTimeout = 65_000;
    server.headersTimeout = 66_000;

    server.on("error", error => {
      if (error.code === "EADDRINUSE") {
        console.error(`Startup failed: port ${config.port} is already in use. Close the other server or change PORT in .env.`);
      } else {
        console.error(`Startup failed: ${error.message}`);
      }
      process.exit(1);
    });
  })
  .catch(error => {
    console.error(`Startup failed: could not connect to MongoDB (${error.message}). Is MongoDB running?`);
    process.exit(1);
  });
