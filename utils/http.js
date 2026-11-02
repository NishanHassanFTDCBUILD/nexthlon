// An error that carries an HTTP status code, and optional messages for each form field.
class HttpError extends Error {
  constructor(status, message, fieldErrors) {
    super(message);
    this.status = status;
    if (fieldErrors) this.fieldErrors = fieldErrors;
  }
}

// Lets async route handlers throw, and passes the error to the error handler.
const asyncHandler = handler => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

// Only allow redirects to pages on this site, never to another website.
function safeNextPath(value, fallback = "/") {
  const path = String(value || "");
  const isLocal = path.startsWith("/") && !path.startsWith("//") && !path.startsWith("/\\");
  return isLocal && !path.startsWith("/api") ? path : fallback;
}

module.exports = { HttpError, asyncHandler, safeNextPath };
