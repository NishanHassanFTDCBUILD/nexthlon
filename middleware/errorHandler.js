const { HttpError } = require("../utils/http");
const logger = require("../utils/logger");
const monitor = require("../utils/monitor");

function isApiRequest(req) {
  return req.originalUrl.startsWith("/api/");
}

function notFound(req, res, next) {
  next(new HttpError(404, isApiRequest(req)
    ? `No API route for ${req.method} ${req.path}`
    : "We couldn't find that page."));
}

// The last stop for every error. API requests get JSON, pages get a friendly error page.
// Server errors never show their real details to the visitor.
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  let status = err.status || err.statusCode || 500;
  if (err.name === "ValidationError" || err.name === "CastError") status = 400;
  if (err.code === 11000) status = 409;

  let message;
  if (status >= 500 && err instanceof HttpError) {
    // A 5xx we raised on purpose (e.g. the payment gateway is down) carries a message written
    // for the shopper, so it is shown. Unexpected errors never show their details.
    message = err.message;
  } else if (status >= 500) {
    message = "Something went wrong on our side. Please try again in a moment.";
  } else if (err instanceof HttpError || err.expose) {
    message = err.message;
  } else if (status === 409) {
    message = "That record already exists.";
  } else {
    message = "Some of the details are not valid.";
  }

  // Every server error is logged with the request's ID (and the stack) and sent to the alert service.
  // The query string is left out of the log: it can hold tokens.
  if (status >= 500) {
    logger.error("http.error", { method: req.method, path: req.originalUrl.split("?")[0], status, error: err, stack: err && err.stack });
    monitor.captureException(err, { method: req.method, path: req.originalUrl.split("?")[0] });
  }

  // A failure must never be kept by a CDN (a store page may have said it could be, before it failed).
  if (status >= 500 || status === 429) res.set("Cache-Control", "no-store, private, max-age=0");

  if (isApiRequest(req)) {
    const body = { message };
    if (err.fieldErrors) body.errors = err.fieldErrors;
    if (err instanceof HttpError && err.reason) body.code = err.reason;
    // Quote this when asking for help: it finds the exact request in the logs.
    if (status >= 500 && req.id) body.requestId = req.id;
    return res.status(status).json(body);
  }
  return res.status(status).render(status === 404 ? "pages/404" : "pages/error", {
    title: status === 404 ? "Page not found" : "Something went wrong",
    status,
    message
  });
}

module.exports = { notFound, errorHandler };
