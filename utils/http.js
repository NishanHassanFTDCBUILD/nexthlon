// An error that carries an HTTP status code, optional messages for each form field, and an optional
// short reason code ("cart_limit") the browser can act on without reading the message text.
class HttpError extends Error {
  constructor(status, message, fieldErrors, reason) {
    super(message);
    this.status = status;
    if (fieldErrors) this.fieldErrors = fieldErrors;
    if (reason) this.reason = reason;
  }
}

// Lets async route handlers throw, and passes the error to the error handler.
const asyncHandler = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

// Only allow redirects to pages on this site, never to another website.
function safeNextPath(value, fallback = '/') {
  const path = String(value || '');
  const isLocal =
    path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/\\');
  return isLocal && !path.startsWith('/api') ? path : fallback;
}

module.exports = {HttpError, asyncHandler, safeNextPath};
