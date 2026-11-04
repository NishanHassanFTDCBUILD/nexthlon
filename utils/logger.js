// A small logger with levels. Set LOG_LEVEL to error, warn, info or debug (default info);
// tests are silent. Detail keys that could hold secrets or card data are never written.
const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const HIDDEN = /secret|password|token|signature|card|cvv|otp|authorization|cookie/i;

function currentLevel() {
  if (process.env.NODE_ENV === "test" && !process.env.LOG_LEVEL) return -1;
  const name = String(process.env.LOG_LEVEL || "info").toLowerCase();
  return Object.hasOwn(LEVELS, name) ? LEVELS[name] : LEVELS.info;
}

function clean(details) {
  if (!details || typeof details !== "object") return "";
  return Object.entries(details)
    .filter(([key, value]) => value !== undefined && value !== "" && !HIDDEN.test(key))
    .map(([key, value]) => `${key}=${value instanceof Error ? value.message : typeof value === "object" ? JSON.stringify(value) : value}`)
    .join(" ");
}

function write(level, event, details) {
  if (LEVELS[level] > currentLevel()) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase()} ${event} ${clean(details)}`.trim();
  (level === "error" ? console.error : level === "warn" ? console.warn : console.info)(line);
}

module.exports = {
  error: (event, details) => write("error", event, details),
  warn: (event, details) => write("warn", event, details),
  info: (event, details) => write("info", event, details),
  debug: (event, details) => write("debug", event, details),
  clean
};
