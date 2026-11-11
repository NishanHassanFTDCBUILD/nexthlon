// Gives every request an ID, so one customer's problem can be followed through the logs, the error
// alerts and the "reference" shown on the error page.
//   - A valid X-Request-Id sent by the proxy (or a monitoring tool) is kept, so the ID is the same
//     in the load balancer's logs and ours. Anything else is replaced by a new random one.
//   - The ID goes back in the X-Request-Id response header.
//   - When the request finishes, one access-log line is written (see below).
const crypto = require("node:crypto");
const context = require("../utils/requestContext");
const logger = require("../utils/logger");

const VALID_ID = /^[A-Za-z0-9._-]{8,64}$/;
// Files that would only add noise to the access log: assets, fonts, photos, health checks.
const QUIET = /^\/(css|js|img|fonts|uploads)\/|^\/(healthz|readyz|robots\.txt|favicon\.ico)$/;

function requestId(req, res, next) {
  const sent = req.get("x-request-id");
  const id = sent && VALID_ID.test(sent) ? sent : crypto.randomUUID();
  req.id = id;
  res.locals.requestId = id;
  res.setHeader("X-Request-Id", id);

  const started = process.hrtime.bigint();
  res.on("finish", () => {
    // Only the path is logged: a query string can hold tokens (password reset links, order lookups).
    const path = req.originalUrl.split("?")[0];
    if (QUIET.test(path) && res.statusCode < 400) return;
    const ms = Number((process.hrtime.bigint() - started) / 1_000_000n);
    const level = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";
    logger[level]("http.request", { method: req.method, path, status: res.statusCode, ms, user: req.user ? String(req.user._id) : undefined });
  });

  context.run({ requestId: id }, next);
}

module.exports = { requestId, VALID_ID };
