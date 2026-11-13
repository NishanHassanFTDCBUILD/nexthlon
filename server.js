let config;
try {
  config = require("./config/env");
} catch (error) {
  console.error(`Startup failed: ${error.message}`);
  process.exit(1);
}

const cluster = require("cluster");
const logger = require("./utils/logger");
const monitor = require("./utils/monitor");
const lifecycle = require("./utils/lifecycle");

// Error alerts first, so even a failure while starting is reported (does nothing without SENTRY_DSN).
monitor.init();

// One copy of the app uses one CPU core. With WEB_CONCURRENCY above 1 ("auto": one per core) this process
// becomes a small supervisor: it runs the database migrations once, starts that many copies of the store
// (they share the port), restarts a copy that crashes, and passes a shutdown on to all of them.
// docs/SCALING.md explains how this fits with several servers.
if (config.webConcurrency > 1 && cluster.isPrimary) startSupervisor();
else startServer();

function startSupervisor() {
  config.warnings.forEach(warning => logger.warn("config", { warning }));
  const connectDB = require("./config/db");
  const mongoose = require("mongoose");
  const copies = config.webConcurrency;
  let stopping = false;
  const restarts = [];

  const fork = index => {
    // Copy 0 also runs the background jobs (emails, reminders); the others only serve visitors.
    const worker = cluster.fork({ NX_COPY: String(index), NX_SKIP_MIGRATIONS: "1" });
    worker.nxCopy = index;
    return worker;
  };

  cluster.on("exit", (worker, code, signal) => {
    if (stopping) return;
    logger.error("copy.exited", { copy: worker.nxCopy, code, signal });
    // A copy that keeps crashing at once is not restarted in a tight loop: at most 5 restarts a minute.
    const now = Date.now();
    restarts.push(now);
    while (restarts.length && restarts[0] < now - 60_000) restarts.shift();
    if (restarts.length > 5) {
      logger.error("copy.restart_paused", { copy: worker.nxCopy });
      setTimeout(() => { if (!stopping) fork(worker.nxCopy); }, 30_000).unref();
      return;
    }
    fork(worker.nxCopy);
  });

  const shutdown = signal => {
    if (stopping) return;
    stopping = true;
    logger.info("shutdown.start", { signal, copies: Object.keys(cluster.workers).length });
    Object.values(cluster.workers).forEach(worker => worker.process.kill("SIGTERM"));
    // Each copy finishes its requests and exits on its own (startServer); this is the backstop.
    const force = setTimeout(() => process.exit(1), 15_000);
    force.unref();
    cluster.on("exit", () => {
      if (!Object.keys(cluster.workers).length) process.exit(0);
    });
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  connectDB()
    .then(() => require("./services/migrationService").runMigrations())
    // Its own connection was only for the migrations: close it quietly (not a lost connection).
    .then(() => { mongoose.connection.removeAllListeners("disconnected"); return mongoose.disconnect(); })
    .then(() => {
      console.log(`Nexthlon starting ${copies} copies on port ${config.port}${process.env.WEB_CONCURRENCY === "auto" ? " (one per CPU core)" : ""}`);
      for (let index = 0; index < copies; index += 1) fork(index);
    })
    .catch(error => {
      console.error(`Startup failed: could not prepare the database (${error.message}).`);
      process.exit(1);
    });
}

function startServer() {
  if (cluster.isPrimary) config.warnings.forEach(warning => logger.warn("config", { warning }));
  const app = require("./app");
  const connectDB = require("./config/db");
  const mongoose = require("mongoose");
  const { createWorker } = require("./jobs/worker");

  const SHUTDOWN_GRACE_MS = 10_000;
  const copy = process.env.NX_COPY;
  let server;
  // Background jobs (emails, reminders) run in this process unless JOBS_ENABLED=false (then: npm run worker).
  // With several copies, only copy 0 runs them.
  const runsJobs = config.jobs.enabled && (copy === undefined || copy === "0");
  const worker = runsJobs ? createWorker({ concurrency: config.jobs.concurrency }) : null;

  // A deploy or restart sends SIGTERM (Ctrl+C sends SIGINT). Stop taking new visitors, let the requests
  // in progress finish, close the database, then exit. If that takes too long, exit anyway.
  async function shutdown(signal) {
    if (lifecycle.isShuttingDown()) return;
    lifecycle.markShuttingDown();
    logger.info("shutdown.start", { signal, copy });
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
      // Let the jobs running now finish (an email must not be cut in half); queued ones wait for the next start.
      if (worker) await worker.stop();
      await require("./providers/redis").close();
      await mongoose.disconnect();
      await monitor.flush();
      logger.info("shutdown.done", { copy });
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
  // (the host, or the supervisor above, restarts it).
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
    // With several copies the supervisor has already run the migrations once.
    .then(() => (process.env.NX_SKIP_MIGRATIONS === "1" ? null : require("./services/migrationService").runMigrations()))
    .then(() => {
      // 0.0.0.0: reachable from other devices (a phone on the same network, a container's port).
      server = app.listen(config.port, "0.0.0.0", () => {
        if (copy === undefined) console.log(`Nexthlon running at http://localhost:${config.port}`);
        else if (copy === "0") console.log(`Nexthlon running at http://localhost:${config.port} (${config.webConcurrency} copies)`);
      });

      if (worker) worker.start();

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
}
