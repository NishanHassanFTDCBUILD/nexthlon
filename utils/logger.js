// A small logger with levels. Set LOG_LEVEL to error, warn, info or debug (default info);
// tests are silent. Detail keys that could hold secrets or card data are never written.
//
// Every line carries the request's ID (req=...) while a request is being handled, so one customer's
// problem can be followed through the logs. LOG_FORMAT=json writes one JSON object per line, which
// hosting platforms and log tools (Datadog, Better Stack, CloudWatch) can search by field; the
// default is plain text, which is easier to read in a terminal.
const context = require('./requestContext');

const LEVELS = {error: 0, warn: 1, info: 2, debug: 3};
const HIDDEN =
  /secret|password|token|signature|card|cvv|otp|authorization|cookie/i;

function currentLevel() {
  if (process.env.NODE_ENV === 'test' && !process.env.LOG_LEVEL) return -1;
  const name = String(process.env.LOG_LEVEL || 'info').toLowerCase();
  return Object.hasOwn(LEVELS, name) ? LEVELS[name] : LEVELS.info;
}

function useJson() {
  return String(process.env.LOG_FORMAT || '').toLowerCase() === 'json';
}

function value(item) {
  return item instanceof Error ? item.message : item;
}

function entries(details) {
  if (!details || typeof details !== 'object') return [];
  return Object.entries(details).filter(
    ([key, item]) => item !== undefined && item !== '' && !HIDDEN.test(key),
  );
}

function clean(details) {
  return entries(details)
    .map(
      ([key, item]) =>
        `${key}=${typeof value(item) === 'object' ? JSON.stringify(value(item)) : value(item)}`,
    )
    .join(' ');
}

function write(level, event, details) {
  if (LEVELS[level] > currentLevel()) return;
  const req = context.requestId();
  const print =
    level === 'error'
      ? console.error
      : level === 'warn'
        ? console.warn
        : console.info;
  if (useJson()) {
    const fields = Object.fromEntries(
      entries(details).map(([key, item]) => [key, value(item)]),
    );
    print(
      JSON.stringify({
        time: new Date().toISOString(),
        level,
        event,
        req,
        ...fields,
      }),
    );
    return;
  }
  print(
    `${new Date().toISOString()} ${level.toUpperCase()} ${event} ${req ? `req=${req} ` : ''}${clean(details)}`.trim(),
  );
}

module.exports = {
  error: (event, details) => write('error', event, details),
  warn: (event, details) => write('warn', event, details),
  info: (event, details) => write('info', event, details),
  debug: (event, details) => write('debug', event, details),
  clean,
};
