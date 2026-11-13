// Optional Redis, for what several copies of the store must share (docs/SCALING.md):
//   - rate limits (middleware/rateLimit.js): a visitor cannot dodge a limit by landing on another copy
//   - cache clearing (services/cacheSync.js): a product change clears the catalogue cache on every copy
// Without REDIS_URL nothing here connects and every caller falls back to this process alone, which is
// right for one server. If Redis goes down, callers fall back the same way until it is back; the store
// keeps working.
const config = require("../config/env");
const logger = require("../utils/logger");

let client = null;
let connecting = null;
const subscribers = [];

const enabled = () => Boolean(config.redisUrl);

function createClient() {
  const { createClient: make } = require("redis");
  const made = make({
    url: config.redisUrl,
    // Keep trying, a little slower each time, up to every 5 seconds.
    socket: { connectTimeout: 5000, reconnectStrategy: retries => Math.min(200 * (retries + 1), 5000) }
  });
  // One line per problem, never the address (it holds the password).
  made.on("error", error => logger.warn("redis.error", { error: error.message }));
  return made;
}

// The shared client, or null (no REDIS_URL, or not reachable right now).
async function getClient() {
  if (!enabled()) return null;
  if (client && client.isReady) return client;
  if (!connecting) {
    connecting = (async () => {
      const made = createClient();
      await made.connect();
      client = made;
      logger.info("redis.connected");
      return made;
    })().catch(error => {
      logger.warn("redis.unavailable", { error: error.message });
      connecting = null;
      return null;
    });
  }
  const ready = await connecting;
  return ready && ready.isReady ? ready : null;
}

// Listens on a channel; handler(message) runs for every message, including this copy's own.
// A subscription needs a connection of its own.
async function subscribe(channel, handler) {
  if (!enabled()) return false;
  try {
    const listener = createClient();
    await listener.connect();
    await listener.subscribe(channel, message => {
      try {
        handler(message);
      } catch (error) {
        logger.warn("redis.handler_failed", { channel, error: error.message });
      }
    });
    subscribers.push(listener);
    return true;
  } catch (error) {
    logger.warn("redis.subscribe_failed", { channel, error: error.message });
    return false;
  }
}

async function publish(channel, message) {
  const shared = await getClient();
  if (!shared) return false;
  try {
    await shared.publish(channel, message);
    return true;
  } catch (error) {
    logger.warn("redis.publish_failed", { channel, error: error.message });
    return false;
  }
}

// Closes every connection (server shutdown). Safe to call when nothing was opened.
async function close() {
  const all = [client, ...subscribers.splice(0)].filter(Boolean);
  client = null;
  connecting = null;
  await Promise.all(all.map(c => c.quit().catch(() => c.disconnect().catch(() => {}))));
}

module.exports = { enabled, getClient, subscribe, publish, close };
