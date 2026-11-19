const {MemoryStore} = require('express-rate-limit');
const redis = require('../providers/redis');

// Where a rate limiter keeps its counts. With Redis (REDIS_URL) the counts are shared by every copy of
// the store, so a visitor cannot get more tries by landing on another server. Without Redis, or while
// Redis cannot be reached, the counts stay in this process (the library's own memory store), so the
// limit still holds per copy and nothing breaks.

// One round trip, atomic: add one hit, start the window on the first hit, and say how long is left.
const HIT = `
local hits = redis.call("INCR", KEYS[1])
if hits == 1 then redis.call("PEXPIRE", KEYS[1], ARGV[1]) end
local left = redis.call("PTTL", KEYS[1])
if left < 0 then redis.call("PEXPIRE", KEYS[1], ARGV[1]); left = tonumber(ARGV[1]) end
return { hits, left }`;

class SharedStore {
  // name: a fixed name per limiter, so every copy counts in the same place.
  // getClient: for tests; normally the shared Redis connection.
  constructor(name, {getClient = redis.getClient} = {}) {
    this.prefix = `nexthlon:rl:${name}:`;
    this.getClient = getClient;
    this.memory = new MemoryStore();
    // Counts live outside this process (express-rate-limit uses this to word its warnings).
    this.localKeys = false;
  }

  init(options) {
    this.windowMs = options.windowMs;
    this.memory.init(options);
  }

  async shared() {
    try {
      return await this.getClient();
    } catch {
      return null;
    }
  }

  async increment(key) {
    const client = await this.shared();
    if (client) {
      try {
        const [hits, left] = await client.eval(HIT, {
          keys: [this.prefix + key],
          arguments: [String(this.windowMs)],
        });
        return {
          totalHits: Number(hits),
          resetTime: new Date(Date.now() + Number(left)),
        };
      } catch {
        /* Redis failed this time: count in memory instead */
      }
    }
    return this.memory.increment(key);
  }

  async decrement(key) {
    const client = await this.shared();
    if (client) {
      try {
        await client.decr(this.prefix + key);
        return;
      } catch {
        /* fall through to memory */
      }
    }
    await this.memory.decrement(key);
  }

  async resetKey(key) {
    const client = await this.shared();
    if (client) {
      try {
        await client.del(this.prefix + key);
      } catch {
        /* nothing to undo */
      }
    }
    await this.memory.resetKey(key);
  }
}

module.exports = {SharedStore, HIT};
