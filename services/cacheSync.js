// Keeps the catalogue cache (utils/memo.js) in step across every copy of the store. Each copy keeps its own
// cache (fast, nothing to send over the network), and when one copy clears a group (a product was edited,
// stock went down with an order) it tells the others through Redis, so they clear it too, straight away.
// Without Redis this does nothing, and other copies catch up when their copy runs out (30 seconds at most).
const crypto = require("crypto");
const memo = require("../utils/memo");
const redis = require("../providers/redis");
const logger = require("../utils/logger");

const CHANNEL = "nexthlon:memo:forget";
// Who sent a message, so a copy ignores its own.
const self = crypto.randomBytes(8).toString("hex");

// A message from another copy: { from, prefix }. Anything else is ignored.
function handleMessage(raw) {
  let message;
  try {
    message = JSON.parse(raw);
  } catch {
    return false;
  }
  if (!message || message.from === self || typeof message.prefix !== "string" || message.prefix.length > 200) return false;
  memo.forget(message.prefix, { fromPeer: true });
  return true;
}

let started = false;
function start() {
  if (started || !redis.enabled()) return;
  started = true;
  memo.onForget(prefix => {
    redis.publish(CHANNEL, JSON.stringify({ from: self, prefix })).catch(() => {});
  });
  redis.subscribe(CHANNEL, handleMessage).then(ok => {
    if (ok) logger.info("cache_sync.started");
  });
}

module.exports = { start, handleMessage, CHANNEL, self };
