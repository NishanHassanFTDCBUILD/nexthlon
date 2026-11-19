// Error alerts through Sentry, switched on only when SENTRY_DSN is set. Without it, every function here
// does nothing and the SDK is never even loaded.
//
// What is sent: the error, the request's method and path, its ID, and the release. What is NOT sent:
// cookies, headers, request bodies, query strings, IP addresses or signed-in users' details
// (scrubbed in beforeSend, and sendDefaultPii stays off).
const config = require('../config/env');
const context = require('./requestContext');
const logger = require('./logger');

let sentry = null;

function scrub(event) {
  if (event.request) {
    delete event.request.cookies;
    delete event.request.headers;
    delete event.request.data;
    delete event.request.query_string;
    if (event.request.url) event.request.url = event.request.url.split('?')[0];
  }
  delete event.user;
  return event;
}

function init() {
  if (sentry || !config.sentry.enabled) return false;
  try {
    sentry = require('@sentry/node');
    sentry.init({
      dsn: config.sentry.dsn,
      environment: config.sentry.environment,
      release: config.release,
      sendDefaultPii: false,
      tracesSampleRate: 0,
      // The default "Modules" integration would send the list of installed packages and their versions.
      integrations: (defaults) =>
        defaults.filter((integration) => integration.name !== 'Modules'),
      beforeSend: scrub,
    });
    logger.info('monitor.on', {
      provider: 'sentry',
      environment: config.sentry.environment,
    });
    return true;
  } catch (error) {
    sentry = null;
    logger.warn('monitor.failed_to_start', {error});
    return false;
  }
}

// Reports an error with the current request's ID, method and path. Never throws.
function captureException(error, extra = {}) {
  if (!sentry) return;
  try {
    const requestId = context.requestId();
    sentry.withScope((scope) => {
      if (requestId) scope.setTag('request_id', requestId);
      for (const [key, item] of Object.entries(extra))
        scope.setExtra(key, item);
      sentry.captureException(error);
    });
  } catch {
    /* an alerting problem must never break a request */
  }
}

// Sends what is queued before the process exits (a restart, a crash).
async function flush(timeoutMs = 2000) {
  if (!sentry) return;
  try {
    await sentry.flush(timeoutMs);
  } catch {
    /* shutting down anyway */
  }
}

module.exports = {init, captureException, flush, isOn: () => Boolean(sentry)};
